// 🎫 Account session tokens shared by every sign-in method.

import jwt from 'jsonwebtoken';
import { config } from '../config';

// Sessions renew while the extension is used (see /api/oauth/session), so an
// active account never silently drops back to Free after a fixed day.
export const SESSION_TTL_SECONDS = 14 * 24 * 60 * 60;

export function issueSessionToken(userId: string): string {
  return jwt.sign({ userId, timestamp: Date.now() }, config.jwtSecret, {
    expiresIn: SESSION_TTL_SECONDS,
  });
}

export class SessionTokenError extends Error {}

/**
 * Reads an optional Bearer session. A missing header returns null; a present but
 * invalid token throws so callers never fall back to creating a second account.
 */
export function readOptionalSessionUserId(authorization?: string): string | null {
  if (!authorization) return null;
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as { userId?: unknown };
    if (typeof decoded.userId !== 'string' || !decoded.userId) {
      throw new SessionTokenError('Malformed session token');
    }
    return decoded.userId;
  } catch (error) {
    if (error instanceof SessionTokenError) throw error;
    throw new SessionTokenError('Invalid session token');
  }
}
