// Email one-time code and Google account sign-in.

import { Router, Response } from 'express';
import type { SignInMethod } from '@bookmark-assistant/types';
import { asyncHandler } from '../middleware/async-handler';
import { validateExtension } from '../middleware/auth';
import { authRateLimit } from '../middleware/security';
import {
  AccountConflictError,
  findOrCreateByVerifiedEmail,
  linkGoogleIdentity,
  resolveGoogleAccount,
} from '../services/account';
import {
  EmailLoginCodeError,
  normalizeLoginEmail,
  startEmailLogin,
  verifyEmailLogin,
} from '../services/email-login-code';
import { emailLogRef } from '../services/mailer';
import {
  assertAllowedGoogleRedirect,
  exchangeGoogleCode,
  GoogleSignInError,
} from '../services/google-auth';
import {
  issueSessionToken,
  readOptionalSessionUserId,
  SessionTokenError,
} from '../services/session';
import { userPrisma } from '../services/userPrisma';
import { auditLog, sanitizeError } from '../utils';

const router: import('express').Router = Router();
router.use(authRateLimit);

function extensionId(header: unknown): string {
  return typeof header === 'string' ? header : '';
}

function localeOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 35 ? value : undefined;
}

function emailStatus(error: EmailLoginCodeError): number {
  switch (error.code) {
    case 'EMAIL_INVALID':
      return 400;
    case 'EMAIL_SIGN_IN_DISABLED':
      return 403;
    case 'EMAIL_CODE_RATE_LIMITED':
      return 429;
    case 'EMAIL_DELIVERY_FAILED':
      return 503;
    default:
      return 401;
  }
}

function googleStatus(error: GoogleSignInError): number {
  if (error.code === 'GOOGLE_SIGN_IN_UNAVAILABLE') return 503;
  if (error.code === 'GOOGLE_REDIRECT_REJECTED') return 400;
  return 401;
}

async function optionalSessionUserId(authorization: unknown): Promise<string | null> {
  const header = typeof authorization === 'string' ? authorization : undefined;
  const presented = readOptionalSessionUserId(header);
  if (!presented) return null;
  const userId = await userPrisma.resolveInternalUserId(presented);
  if (!userId) throw new SessionTokenError('Account not found');
  return userId;
}

function sessionBody(account: {
  id: string;
  email: string | null;
  notionAccessToken?: string | null;
  created?: boolean;
}) {
  return {
    success: true,
    sessionToken: issueSessionToken(account.id),
    userId: account.id,
    userEmail: account.email,
    accountCreated: account.created === true,
    hasNotionAccess: !!account.notionAccessToken,
    message: 'Sign-in successful',
  };
}

router.post(
  '/email/start',
  validateExtension,
  asyncHandler(async (req, res: Response) => {
    const email = normalizeLoginEmail(req.body?.email);
    if (!email) {
      return res
        .status(400)
        .json({ error: 'Bad Request', message: 'Enter a valid email address.' });
    }
    try {
      await startEmailLogin({ email, locale: localeOf(req.body?.locale) });
      auditLog('email_login_start', emailLogRef(email), { accepted: true });
      return res.status(202).json({ accepted: true });
    } catch (error) {
      if (error instanceof EmailLoginCodeError) {
        auditLog('email_login_start_rejected', emailLogRef(email), { code: error.code });
        return res.status(emailStatus(error)).json({
          error:
            error.code === 'EMAIL_CODE_RATE_LIMITED' ? 'Too Many Requests' : 'Email Sign-In Failed',
          code: error.code,
          message: error.message,
        });
      }
      console.error('Email sign-in start failed:', sanitizeError(error));
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to start email sign-in',
      });
    }
  })
);

router.post(
  '/email/verify',
  validateExtension,
  asyncHandler(async (req, res: Response) => {
    try {
      const verified = await verifyEmailLogin({
        email: req.body?.email,
        code: req.body?.code,
      });
      const account = await findOrCreateByVerifiedEmail(verified.email);
      auditLog('email_login_success', account.id, {
        created: account.created,
        plan: account.plan,
      });
      return res.json(sessionBody(account));
    } catch (error) {
      if (error instanceof EmailLoginCodeError) {
        auditLog('email_login_rejected', 'unknown', { code: error.code });
        return res.status(emailStatus(error)).json({
          error: 'Email Sign-In Failed',
          code: error.code,
          message: error.message,
        });
      }
      console.error('Email sign-in verify failed:', sanitizeError(error));
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to verify the sign-in code',
      });
    }
  })
);

router.post(
  '/google/exchange',
  validateExtension,
  asyncHandler(async (req, res: Response) => {
    const { code, redirectUri, codeVerifier } = req.body ?? {};
    if (
      typeof code !== 'string' ||
      !code ||
      typeof redirectUri !== 'string' ||
      !redirectUri ||
      typeof codeVerifier !== 'string' ||
      !codeVerifier
    ) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'code, redirectUri and codeVerifier are required',
      });
    }

    let sessionUserId: string | null;
    try {
      sessionUserId = await optionalSessionUserId(req.headers.authorization);
    } catch (error) {
      if (!(error instanceof SessionTokenError)) throw error;
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid session token' });
    }

    try {
      assertAllowedGoogleRedirect(redirectUri, extensionId(req.headers['x-extension-id']));
      const identity = await exchangeGoogleCode({ code, redirectUri, codeVerifier });
      const account = sessionUserId
        ? { ...(await linkGoogleIdentity(sessionUserId, identity)), created: false }
        : await resolveGoogleAccount(identity);
      auditLog('google_sign_in_success', account.id, {
        plan: account.plan,
        linkedToSession: !!sessionUserId,
      });
      return res.json(sessionBody(account));
    } catch (error) {
      if (error instanceof GoogleSignInError) {
        auditLog('google_sign_in_error', 'unknown', { code: error.code });
        return res.status(googleStatus(error)).json({
          error: 'Google Sign-In Failed',
          code: error.code,
          message: error.message,
        });
      }
      if (error instanceof AccountConflictError) {
        auditLog('google_sign_in_error', 'unknown', { code: error.code });
        return res
          .status(409)
          .json({ error: 'Conflict', code: error.code, message: error.message });
      }
      console.error('Google sign-in error:', sanitizeError(error));
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to complete Google sign-in',
      });
    }
  })
);

export type { SignInMethod };
export default router;
