/**
 * Test Server Setup
 * Provides utilities for running a test server with in-memory database
 */
import express from 'express';
import type { Server } from 'http';

export interface TestServerConfig {
  port?: number;
  mockNotionAPI?: boolean;
  mockPaddleAPI?: boolean;
}

export class TestServer {
  private app: express.Application;
  private server: Server | null = null;
  public port: number;
  public baseUrl: string;

  constructor(config: TestServerConfig = {}) {
    this.port = config.port || 3334;
    this.baseUrl = `http://localhost:${this.port}`;
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware() {
    this.app.use(express.json());
    this.app.use((req, res, next) => {
      console.log(`[TEST SERVER] ${req.method} ${req.path}`);
      next();
    });
  }

  private setupRoutes() {
    // Health check
    this.app.get('/api/health', (req, res) => {
      res.json({ status: 'healthy', test: true });
    });

    // Mock OAuth token exchange
    this.app.post('/api/oauth/exchange', (req, res) => {
      const { code } = req.body;
      if (!code) {
        return res.status(400).json({ error: 'Missing code' });
      }
      res.json({
        sessionToken: 'test-session-token',
        user: {
          userId: 'test-user-123',
          userEmail: 'test@example.com',
        },
      });
    });

    // Mock bookmark sync
    this.app.post('/api/bookmarks/sync', (req, res) => {
      const { bookmarks } = req.body;
      res.json({
        summary: {
          total: bookmarks?.length || 0,
          success: bookmarks?.length || 0,
          failed: 0,
        },
        results: [],
      });
    });

    // Mock user profile
    this.app.get('/api/user/profile', (req, res) => {
      res.json({
        user: {
          userId: 'test-user-123',
          email: 'test@example.com',
          plan: 'pro',
        },
        isPro: true,
      });
    });

    // Mock pricing
    this.app.get('/api/pricing', (req, res) => {
      res.json({
        pricing: {
          monthly: 5,
          yearly: 50,
        },
      });
    });
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        console.log(`[TEST SERVER] Running on ${this.baseUrl}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((err) => {
        if (err) reject(err);
        else {
          console.log('[TEST SERVER] Stopped');
          resolve();
        }
      });
    });
  }

  // Helper to add custom routes for specific tests
  addRoute(method: string, path: string, handler: express.RequestHandler) {
    (this.app as any)[method.toLowerCase()](path, handler);
  }
}

export async function createTestServer(config?: TestServerConfig): Promise<TestServer> {
  const server = new TestServer(config);
  await server.start();
  return server;
}
