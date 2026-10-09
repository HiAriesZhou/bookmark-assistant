// 🔗 Notion API Routes

import { Router, Response } from 'express';
import { AuthenticatedRequest, DatabaseQueryRequest } from '../types';
import { validateSession } from '../middleware/auth';
import { notionService } from '../services/notion';
import { userPrisma } from '../services/userPrisma';
import { auditLog, sanitizeError } from '../utils';

const router: import('express').Router = Router();

/**
 * Query Notion Database
 * Executes queries against user's Notion databases
 */
router.post(
  '/query-database',
  validateSession,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      const userData = await userPrisma.find(userId);
      const { dataSourceId, databaseId, filter, sorts }: DatabaseQueryRequest = req.body;

      if (!userData) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'User data not found',
        });
      }

      // Prefer dataSourceId; resolve from databaseId if needed
      let effectiveDataSourceId = dataSourceId as string | undefined;
      if (!effectiveDataSourceId && databaseId) {
        effectiveDataSourceId = await notionService.getPrimaryDataSourceId(
          databaseId,
          userData.notionAccessToken
        );
      }
      if (!effectiveDataSourceId) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'dataSourceId (preferred) or a resolvable databaseId is required',
        });
      }

      const data = await notionService.queryDataSource(
        effectiveDataSourceId,
        userData.notionAccessToken,
        filter,
        sorts
      );

      // lastActivity is updated by DB writes elsewhere; no-op here

      auditLog('database_query_success', userId, {
        databaseId,
        resultCount: data.results?.length || 0,
      });

      res.json(data);
    } catch (error) {
      const errorMessage = sanitizeError(error);
      auditLog('database_query_error', req.user?.userId || 'unknown', {
        error: errorMessage,
      });

      console.error('Database query error:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to query database',
      });
    }
  }
);

/**
 * Get Notion Databases
 * Retrieves all databases accessible to the user
 */
router.get('/databases', validateSession, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const userData = await userPrisma.find(userId);

    if (!userData) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'User data not found',
      });
    }

    const data = await notionService.searchDataSources(userData.notionAccessToken);

    // Optional: persist databases list if desired in DB; skipping for simplicity

    auditLog('databases_fetch_success', userId, {
      databaseCount: data.results?.length || 0,
    });

    res.json(data);
  } catch (error) {
    const errorMessage = sanitizeError(error);
    auditLog('databases_fetch_error', req.user?.userId || 'unknown', {
      error: errorMessage,
    });

    console.error('Databases fetch error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch databases',
    });
  }
});

/**
 * Create Notion Page
 * Generic endpoint for creating pages in Notion
 */
router.post('/create-page', validateSession, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const userData = await userPrisma.find(userId);
    const { parent, properties, children } = req.body;

    if (!userData) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'User data not found',
      });
    }

    if (!parent || !properties) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Parent and properties are required',
      });
    }

    const data = await notionService.createPage(
      parent,
      properties,
      userData.notionAccessToken,
      children
    );

    // lastActivity is updated by DB writes elsewhere; no-op here

    auditLog('page_create_success', userId, {
      pageId: data.id,
      parentType: parent.type,
    });

    res.json(data);
  } catch (error) {
    const errorMessage = sanitizeError(error);
    auditLog('page_create_error', req.user?.userId || 'unknown', {
      error: errorMessage,
    });

    console.error('Page creation error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create page',
    });
  }
});

/**
 * Get Database Schema
 * Retrieves the schema/structure of a specific database
 */
router.get(
  '/database/:databaseId/schema',
  validateSession,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.userId;
      const userData = await userPrisma.find(userId);
      const { databaseId } = req.params;

      if (!userData) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'User data not found',
        });
      }

      // Query the database to get its schema
      const response = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
        headers: {
          Authorization: `Bearer ${userData.notionAccessToken}`,
          'Notion-Version': '2025-09-03',
        },
      });

      if (!response.ok) {
        const errorData = await response.text();
        return res.status(response.status).json({
          error: 'Notion API Error',
          message: errorData,
        });
      }

      const data = await response.json();
      // lastActivity is updated by DB writes elsewhere; no-op here

      auditLog('database_schema_fetch', userId, {
        databaseId,
        propertyCount: Object.keys(data.properties || {}).length,
      });

      res.json({
        id: data.id,
        title: data.title,
        properties: data.properties,
        created_time: data.created_time,
        last_edited_time: data.last_edited_time,
        data_sources: data.data_sources,
      });
    } catch (error) {
      const errorMessage = sanitizeError(error);
      auditLog('database_schema_error', req.user?.userId || 'unknown', {
        error: errorMessage,
      });

      console.error('Database schema error:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to fetch database schema',
      });
    }
  }
);

export default router;
