/**
 * Vitest Global Setup
 * Mocks Chrome API before any test files are loaded
 */
import { vi } from 'vitest';

// Create a minimal chrome mock for module loading
const chromeMock = {
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
    },
  },
  runtime: {
    sendMessage: vi.fn().mockResolvedValue({}),
  },
  alarms: {
    create: vi.fn(),
    clear: vi.fn(),
  },
};

// Stub globally before any imports
vi.stubGlobal('chrome', chromeMock);
