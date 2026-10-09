// 🔐 OAuth Routes for Notion Integration

import { Router, Response } from 'express';
import jwt from 'jsonwebtoken';
import { isRetryablePersistenceError } from '../core';
import { AuthenticatedRequest, OAuthExchangeRequest } from '../types';
import { validateExtension, validateSession } from '../middleware/auth';
import { notionService } from '../services/notion';
import { userPrisma, prisma, userCompatSelect } from '../services/userPrisma';
import { config } from '../config';
import { auditLog, sanitizeError } from '../utils';

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

    if (existingUser) {
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
        const paidUser = await retryPrismaOperation(
          () => prisma.user.findUnique({ where: { email: notionEmail }, select: userCompatSelect }),
          3,
          'OAuth findUnique by email'
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
    const sessionToken = jwt.sign({ userId: user.id, timestamp: Date.now() }, config.jwtSecret, {
      expiresIn: '24h',
    });

    auditLog('oauth_exchange_success', user.id, {
      hasRefreshToken: !!tokenData.refresh_token,
      plan: user.plan,
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
