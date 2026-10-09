import { describe, expect, it } from 'vitest';
import { deriveConnectionStatus, showsSyncStatus } from './connection-view-model';

describe('connection view model', () => {
  it('keeps an active OAuth session connected during a degraded health check', () => {
    expect(deriveConnectionStatus(true, 'degraded')).toBe('connected');
  });

  it('respects an explicit disconnected dashboard state', () => {
    expect(deriveConnectionStatus(true, 'disconnected')).toBe('disconnected');
  });

  it('does not present an unhydrated session as disconnected', () => {
    expect(deriveConnectionStatus(false, 'disconnected', false)).toBe('checking');
  });

  it('treats a confirmed missing session as disconnected', () => {
    expect(deriveConnectionStatus(false, 'checking')).toBe('disconnected');
    expect(deriveConnectionStatus(false, 'connected')).toBe('disconnected');
  });
});

describe('sync status visibility', () => {
  it('hides sync details until a destination has been connected', () => {
    expect(showsSyncStatus('checking')).toBe(false);
    expect(showsSyncStatus('disconnected')).toBe(false);
    expect(showsSyncStatus('connected')).toBe(true);
    expect(showsSyncStatus('degraded')).toBe(true);
  });
});
