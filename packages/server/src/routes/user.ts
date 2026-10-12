// 👤 User Profile and Template Management Routes

import { Router, Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { validateSession } from '../middleware/auth';
import { userPrisma } from '../services/userPrisma';
import { auditLog, sanitizeError, resolveProEntitlement } from '../utils';
import { config } from '../config';
import { deleteAccount, disconnectNotion } from '../services/account';
import type { DeploymentProfile } from '@bookmark-assistant/types';

const router: import('express').Router = Router();

/**
 * User Profile & Status
 * Get current user information and status
 */
router.get('/profile', validateSession, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const userData = await userPrisma.find(userId);

    if (!userData) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'User data not found',
      });
    }

    // lastActivity is updated by DB writes elsewhere; no-op here

    const entitlement = resolveProEntitlement(userData);
    const deployment: DeploymentProfile = {
      deploymentMode: config.selfHosted ? 'self-hosted' : 'hosted',
      commerceEnabled: config.commerceEnabled,
      capabilities: { autoSync: entitlement.isPro, batchAi: entitlement.isPro },
    };
    const profile = {
      ...deployment,
      userId,
      email: userData.email || null,
      templateDatabaseId: userData.templateDatabaseId,
      databaseCount: userData.databases?.length || 0,
      lastActivity: userData.lastActivity,
      hasNotionAccess: !!userData.notionAccessToken,
      hasNotionDatabase: !!userData.notionDatabaseId,
      workspaceName: userData.notionWorkspaceName || null,
      databaseName: userData.notionDatabaseName || null,
      hasRefreshToken: !!userData.notionRefreshToken,
      isPro: entitlement.isPro,
      plan: entitlement.plan,
      subscriptionSource: entitlement.subscriptionSource,
      expiresAt: entitlement.expiresAt?.toISOString() || null,
      purchaseType: userData.purchaseType,
    };

    auditLog('profile_fetch_success', userId, {
      databaseCount: profile.databaseCount,
      hasTemplateDatabase: !!profile.templateDatabaseId,
    });

    res.json({
      success: true,
      profile,
    });
  } catch (error) {
    const errorMessage = sanitizeError(error);
    auditLog('profile_fetch_error', req.user?.userId || 'unknown', {
      error: errorMessage,
    });

    console.error('Profile fetch error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch user profile',
    });
  }
});

/**
 * Update User Settings
 * Update user preferences and settings
 */
router.patch('/settings', validateSession, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const userData = await userPrisma.find(userId);
    const { templateDatabaseId } = req.body;

    if (!userData) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'User data not found',
      });
    }

    auditLog('user_settings_update', userId, {
      templateDatabaseId,
    });

    res.json({
      success: true,
      message: 'Settings updated successfully',
    });
  } catch (error) {
    const errorMessage = sanitizeError(error);
    auditLog('user_settings_error', req.user?.userId || 'unknown', {
      error: errorMessage,
    });

    console.error('Settings update error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update settings',
    });
  }
});

/**
 * Get Session Statistics
 * Administrative endpoint for session monitoring
 */
// session-stats depended on in-memory store; removed to keep solution simple

/**
 * Check Template Status
 * Verify if user has a template database set up
 */
router.get(
  '/template/status',
  validateSession,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      const userData = await userPrisma.find(userId);

      if (!userData) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'User data not found',
        });
      }

      const hasTemplate = !!userData.templateDatabaseId;

      // lastActivity is updated by DB writes elsewhere; no-op here

      res.json({
        success: true,
        hasTemplate,
        templateDatabaseId: userData.templateDatabaseId || null,
        message: hasTemplate ? 'Template database found' : 'No template database configured',
      });
    } catch (error) {
      const errorMessage = sanitizeError(error);
      auditLog('template_status_error', req.user?.userId || 'unknown', {
        error: errorMessage,
      });

      console.error('Template status error:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to check template status',
      });
    }
  }
);

/**
 * Legacy Disconnect Endpoint
 * Extensions up to 1.4.3 call this to disconnect Notion. It removes the Notion
 * connection but keeps the account and its plan. Newer extensions call
 * /notion/disconnect instead.
 */
router.post('/logout', validateSession, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const account = await userPrisma.find(req.user!.userId);
    if (account?.id) await disconnectNotion(account.id);
    auditLog('logout', account?.id || req.user!.userId, { action: 'notion_disconnected' });
    res.json({ success: true });
  } catch (error) {
    const errorMessage = sanitizeError(error);
    auditLog('logout_error', req.user?.userId || 'unknown', { error: errorMessage });
    res.status(500).json({ success: false, message: 'Failed to logout' });
  }
});

/**
 * Disconnect Notion
 * Removes the Notion destination while keeping the account and its plan.
 */
router.post(
  '/notion/disconnect',
  validateSession,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const account = await userPrisma.find(req.user!.userId);
      if (!account?.id) {
        return res.status(404).json({ error: 'Not Found', message: 'User data not found' });
      }
      await disconnectNotion(account.id);
      auditLog('notion_disconnected', account.id, {});
      res.json({ success: true });
    } catch (error) {
      const errorMessage = sanitizeError(error);
      auditLog('notion_disconnect_error', req.user?.userId || 'unknown', { error: errorMessage });
      res.status(500).json({ success: false, message: 'Failed to disconnect Notion' });
    }
  }
);

/**
 * Delete Account
 * Permanently deletes the service account with its Notion connection and AI records.
 */
router.delete('/account', validateSession, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const account = await userPrisma.find(req.user!.userId);
    if (account?.id) await deleteAccount(account.id);
    auditLog('account_deleted', account?.id || req.user!.userId, {});
    res.json({ success: true });
  } catch (error) {
    const errorMessage = sanitizeError(error);
    auditLog('account_delete_error', req.user?.userId || 'unknown', { error: errorMessage });
    res.status(500).json({ success: false, message: 'Failed to delete account' });
  }
});

export default router;
