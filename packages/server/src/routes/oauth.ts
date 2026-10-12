// 🔐 OAuth Routes for Notion Integration

import { Router, Response } from 'express';
import { isRetryablePersistenceError } from '../core';
import { AuthenticatedRequest, OAuthExchangeRequest } from '../types';
import { validateExtension, validateSession } from '../middleware/auth';
import { notionService } from '../services/notion';
import { userPrisma, prisma, userCompatSelect } from '../services/userPrisma';
import { auditLog, sanitizeError } from '../utils';
import {
  issueSessionToken,
  readOptionalSessionUserId,
  SessionTokenError,
} from '../services/session';
import { exchangeGoogleCode, GoogleSignInError } from '../services/google-auth';
import {
  AccountConflictError,
  findAccountByEmail,
  linkGoogleIdentity,
  resolveGoogleAccount,
} from '../services/account';

const router: import('express').Router = Router();

/**
 * Retry helper for Prisma operations that may encounter connection pool exhaustion
 */
async function retryPrismaOperation<T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  operationName = 'Prisma operation'
): Promise<T> {
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      return await operation();
    } catch (error: any) {
      attempt++;

      if (isRetryablePersistenceError(error) && attempt < maxRetries) {
        // Exponential backoff: 200ms, 400ms, 800ms
        const delayMs = 200 * Math.pow(2, attempt - 1);
        console.warn(
          `[${operationName}] Connection pool exhausted, retrying in ${delayMs}ms (attempt ${attempt}/${maxRetries})...`
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      // If not a pool error or max retries reached, throw
      throw error;
    }
  }

  // Should never reach here, but TypeScript needs this
  throw new Error(`${operationName} failed after ${maxRetries} retries`);
}

/**
 * OAuth Token Exchange Endpoint
 * Exchanges authorization code for access/refresh tokens
 */
router.post('/exchange', validateExtension, async (req, res: Response) => {
  try {
    const { code, redirectUri }: OAuthExchangeRequest & { redirectUri?: string } = req.body;

    if (!code) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Authorization code is required',
      });
    }

    if (!redirectUri) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'redirectUri is required',
      });
    }
    let sessionUserId: string | null;
    try {
      sessionUserId = readOptionalSessionUserId(req.headers.authorization);
    } catch (error) {
      if (!(error instanceof SessionTokenError)) throw error;
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid session token' });
    }
    if (sessionUserId) {
      // Sessions issued before 1.5.0 may carry the Notion user ID.
      sessionUserId = (await userPrisma.resolveInternalUserId(sessionUserId)) ?? null;
      if (!sessionUserId) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Invalid session token' });
      }
    }

    // Exchange code for tokens with Notion
    const tokenData = await notionService.exchangeOAuthCode(code, redirectUri);

    // Extract Notion User Info
    const notionUser = tokenData.owner?.user;
    const notionUserId = notionUser?.id;
    const notionEmail = notionUser?.person?.email || notionUser?.email;

    if (!notionUserId) {
      throw new Error('Failed to get Notion User ID from token exchange');
    }

    console.log('🔐 OAuth exchange for Notion user:', {
      hasEmail: !!notionEmail,
      hasDuplicatedTemplateId: !!(tokenData as any).duplicated_template_id,
      hasWorkspaceId: !!tokenData.workspace_id,
    });

    let user: any; // Prisma User model

    // 2. Step 1: Try Login via Notion ID (with retry)
    const existingUser = await retryPrismaOperation(
      () => prisma.user.findUnique({ where: { notionUserId }, select: userCompatSelect }),
      3,
      'OAuth findUnique by notionUserId'
    );

    if (sessionUserId) {
      // Signed-in account: Notion is a destination linked to this account.
      if (existingUser && existingUser.id !== sessionUserId) {
        return res.status(409).json({
          error: 'Conflict',
          code: 'NOTION_ACCOUNT_LINKED_ELSEWHERE',
          message:
            'This Notion account is linked to another Bookmark Assistant account. Sign in with that account, or delete it before linking Notion here.',
        });
      }
      user = await retryPrismaOperation(
        () =>
          prisma.user.update({
            where: { id: sessionUserId },
            data: {
              notionUserId,
              notionAccessToken: tokenData.access_token,
              notionRefreshToken:
                tokenData.refresh_token || existingUser?.notionRefreshToken || null,
              notionWorkspaceId: tokenData.workspace_id,
              ...(tokenData.workspace_name
                ? { notionWorkspaceName: tokenData.workspace_name }
                : {}),
              lastActivity: new Date(),
            },
            select: userCompatSelect,
          }),
        3,
        'OAuth link Notion to account'
      );
    } else if (existingUser) {
      console.log('✅ Found existing user by Notion ID');
      // Update tokens and activity (with retry)
      user = await retryPrismaOperation(
        () =>
          prisma.user.update({
            where: { id: existingUser.id },
            data: {
              notionAccessToken: tokenData.access_token,
              notionRefreshToken: tokenData.refresh_token || existingUser.notionRefreshToken,
              notionWorkspaceId: tokenData.workspace_id,
              ...(tokenData.workspace_name
                ? { notionWorkspaceName: tokenData.workspace_name }
                : {}),
              lastActivity: new Date(),
            },
            select: userCompatSelect,
          }),
        3,
        'OAuth update existing user'
      );
    } else {
      // 3. Step 2: Try Reconciliation via Email (if Step 1 failed)
      if (notionEmail) {
        // Case-insensitive so a Google account stored in lower case is adopted, not duplicated.
        const paidUser = await retryPrismaOperation(
          () => findAccountByEmail(notionEmail),
          3,
          'OAuth find account by email'
        );

        if (paidUser) {
          console.log('🔗 Found existing paid user by email. Linking Notion account...');
          // MERGE: Link Notion account to existing paid user (with retry)
          user = await retryPrismaOperation(
            () =>
              prisma.user.update({
                where: { id: paidUser.id },
                data: {
                  notionUserId: notionUserId,
                  notionAccessToken: tokenData.access_token,
                  notionRefreshToken: tokenData.refresh_token,
                  notionWorkspaceId: tokenData.workspace_id,
                  ...(tokenData.workspace_name
                    ? { notionWorkspaceName: tokenData.workspace_name }
                    : {}),
                  lastActivity: new Date(),
                },
                select: userCompatSelect,
              }),
            3,
            'OAuth merge user accounts'
          );
        } else {
          console.log('📝 New user creation from Notion OAuth email');
          // CREATE NEW (with retry)
          user = await retryPrismaOperation(
            () =>
              prisma.user.create({
                data: {
                  email: notionEmail,
                  notionUserId: notionUserId,
                  notionAccessToken: tokenData.access_token,
                  notionRefreshToken: tokenData.refresh_token,
                  notionWorkspaceId: tokenData.workspace_id,
                  ...(tokenData.workspace_name
                    ? { notionWorkspaceName: tokenData.workspace_name }
                    : {}),
                  plan: 'free',
                },
                select: userCompatSelect,
              }),
            3,
            'OAuth create new user'
          );
        }
      } else {
        console.warn('⚠️ No email provided by Notion. Cannot reconcile or create user.');
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Email is required from Notion to create an account.',
        });
      }
    }

    // Resolve and persist template -> database mapping if available
    const dupId = (tokenData as any).duplicated_template_id as string | undefined;
    if (dupId) {
      try {
        const resolved = await notionService.resolveDatabaseFromTemplate(
          dupId,
          tokenData.access_token
        );
        // Update user with resolved DB (with retry)
        await retryPrismaOperation(
          () =>
            prisma.user.update({
              where: { id: user.id },
              data: {
                templateDatabaseId: dupId,
                duplicatedTemplateId: dupId, // Sync to both fields for compatibility
                notionDatabaseId: resolved.databaseId,
                notionDataSourceId: resolved.dataSourceId || null,
                ...(resolved.databaseName ? { notionDatabaseName: resolved.databaseName } : {}),
              },
              select: { id: true },
            }),
          3,
          'OAuth update database IDs'
        );
      } catch (e) {
        console.warn('Failed to resolve database from duplicated_template_id:', sanitizeError(e));
        auditLog('oauth_template_resolution_error', user.id, {
          error: sanitizeError(e),
          hasDuplicatedTemplateId: true,
        });

        return res.status(422).json({
          error: 'Template Database Resolution Failed',
          code: 'TEMPLATE_DATABASE_RESOLUTION_FAILED',
          message:
            'Bookmark Assistant connected to Notion, but could not find the duplicated template database. Please wait for template duplication to finish, then reconnect Notion.',
        });
      }
    }

    // Create JWT session token using the internal ID (CUID) only after template resolution succeeds.
    const sessionToken = issueSessionToken(user.id);

    auditLog('oauth_exchange_success', user.id, {
      hasRefreshToken: !!tokenData.refresh_token,
      plan: user.plan,
      linkedToSession: !!sessionUserId,
    });

    // Fetch latest user data (with retry)
    const latest = await retryPrismaOperation(
      () => prisma.user.findUnique({ where: { id: user.id }, select: userCompatSelect }),
      3,
      'OAuth fetch latest user'
    );

    res.json({
      success: true,
      sessionToken,
      userId: user.id, // Return internal ID
      userEmail: latest?.email || null,
      templateDatabaseId: latest?.templateDatabaseId || null,
      message: 'OAuth exchange successful',
    });
  } catch (error) {
    const errorMessage = sanitizeError(error);
    auditLog('oauth_exchange_error', req.body.extensionUserId || 'unknown', {
      error: errorMessage,
    });

    console.error('OAuth exchange error:', errorMessage);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to process OAuth exchange',
    });
  }
});

/**
 * Google Account Sign-In
 * Exchanges a PKCE authorization code for a Bookmark Assistant account session.
 */
router.post('/google', validateExtension, async (req, res: Response) => {
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
    const presented = readOptionalSessionUserId(req.headers.authorization);
    sessionUserId = presented
      ? ((await userPrisma.resolveInternalUserId(presented)) ?? null)
      : null;
    if (presented && !sessionUserId) throw new SessionTokenError('Account not found');
  } catch (error) {
    if (!(error instanceof SessionTokenError)) throw error;
    return res.status(401).json({ error: 'Unauthorized', message: 'Invalid session token' });
  }

  try {
    const identity = await exchangeGoogleCode({ code, redirectUri, codeVerifier });
    const user = await retryPrismaOperation(
      () =>
        sessionUserId
          ? linkGoogleIdentity(sessionUserId, identity)
          : resolveGoogleAccount(identity),
      3,
      sessionUserId ? 'Google identity link' : 'Google account resolution'
    );
    auditLog('google_sign_in_success', user.id, {
      plan: user.plan,
      linkedToSession: !!sessionUserId,
    });
    res.json({
      success: true,
      sessionToken: issueSessionToken(user.id),
      userId: user.id,
      userEmail: user.email,
    });
  } catch (error) {
    if (error instanceof GoogleSignInError) {
      const status = error.code === 'GOOGLE_SIGN_IN_UNAVAILABLE' ? 503 : 401;
      auditLog('google_sign_in_error', 'unknown', { code: error.code });
      return res.status(status).json({ error: 'Google Sign-In Failed', code: error.code });
    }
    if (error instanceof AccountConflictError) {
      auditLog('google_sign_in_error', 'unknown', { code: error.code });
      return res.status(409).json({ error: 'Conflict', code: error.code, message: error.message });
    }
    console.error('Google sign-in error:', sanitizeError(error));
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to complete Google sign-in',
    });
  }
});

/**
 * Session Renewal
 * Issues a fresh session token for an existing account so active users stay signed in.
 */
router.post('/session', validateSession, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const account = await userPrisma.find(userId);
    if (!account?.id) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Account not found' });
    }
    res.json({ success: true, sessionToken: issueSessionToken(account.id) });
  } catch (error) {
    console.error('Session renewal error:', sanitizeError(error));
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to renew session' });
  }
});

/**
 * Token Refresh Endpoint
 * Refreshes expired access tokens using refresh token
 */
router.post('/refresh', validateSession, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const userData = await userPrisma.find(userId);

    if (!userData || !userData.notionRefreshToken) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'No refresh token available',
      });
    }

    const newTokens = await notionService.refreshAccessToken(userData.notionRefreshToken);

    // Use prisma directly instead of userPrisma.update for token refresh
    await retryPrismaOperation(
      () =>
        prisma.user.update({
          where: { id: userId },
          data: {
            notionAccessToken: newTokens.access_token,
          },
        }),
      3,
      'OAuth refresh token update'
    );

    res.json({ success: true, message: 'Access token refreshed' });
  } catch (error) {
    const errorMessage = sanitizeError(error);
    console.error('Token refresh error:', errorMessage);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to refresh token',
    });
  }
});

export default router;
