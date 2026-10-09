// 🪵 Circular File Logger Utility

import fs from 'fs';
import path from 'path';
import { config } from '../config';

// Use config values (with fallback to env vars for backward compatibility)
const LOG_DIR = config.logDir || process.env.LOG_DIR || '/tmp';
const MAX_SIZE = config.logMaxSize || Number(process.env.LOG_MAX_SIZE) || 5 * 1024 * 1024;
const MAX_FILES = config.logMaxFiles || Number(process.env.LOG_MAX_FILES) || 3;

// Check if we're in a serverless environment (Vercel)
const isServerless = !!process.env.VERCEL;

/**
 * Sanitize log input to prevent log injection attacks
 * Escapes control characters that could create fake log entries
 */
function sanitizeLogInput(str: string): string {
  return str.replace(/[\r\n\t]/g, (c) => {
    const escapeMap: Record<string, string> = {
      '\r': '\\r',
      '\n': '\\n',
      '\t': '\\t',
    };
    return escapeMap[c] || c;
  });
}

class CircularFileLogger {
  private logFile: string;
  private currentSize = 0;
  private canWriteToFile: boolean;

  constructor(prefix = 'server') {
    const date = new Date().toISOString().split('T')[0];
    this.logFile = path.join(LOG_DIR, `${prefix}-${date}.log`);

    // Check if we can write to filesystem
    // In serverless, /tmp is ephemeral - logs are lost after execution
    // In production on Vercel, use console.log() for persistent logs
    this.canWriteToFile = !isServerless || config.nodeEnv === 'development';

    if (this.canWriteToFile) {
      this.ensureLogDir();
      this.init();
    }
  }

  private ensureLogDir() {
    try {
      if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
      }
    } catch {
      this.canWriteToFile = false;
    }
  }

  private init() {
    try {
      if (fs.existsSync(this.logFile)) {
        const stats = fs.statSync(this.logFile);
        this.currentSize = stats.size;
      }
    } catch {
      this.canWriteToFile = false;
    }
  }

  private rotateIfNeeded() {
    if (this.currentSize >= MAX_SIZE) {
      this.rotate();
    }
  }

  private rotate() {
    try {
      // Shift: .log.2 -> .log.3, .log.1 -> .log.2, .log -> .log.1
      for (let i = MAX_FILES - 1; i >= 1; i--) {
        const oldFile = `${this.logFile}.${i}`;
        const newFile = `${this.logFile}.${i + 1}`;
        if (fs.existsSync(oldFile)) {
          fs.renameSync(oldFile, newFile);
        }
      }
      if (fs.existsSync(this.logFile)) {
        fs.renameSync(this.logFile, `${this.logFile}.1`);
      }
      this.currentSize = 0;
    } catch {
      // Ignore rotation errors in serverless
    }
  }

  write(level: string, message: string, ...args: any[]) {
    const timestamp = new Date().toISOString();
    // Sanitize message and args to prevent log injection
    const sanitizedMessage = sanitizeLogInput(message);
    const sanitizedArgs = args.map((arg) => {
      if (typeof arg === 'string') return sanitizeLogInput(arg);
      return arg;
    });
    const data = sanitizedArgs.length ? ` ${JSON.stringify(sanitizedArgs)}` : '';
    const logLine = `[${timestamp}] [${level}] ${sanitizedMessage}${data}`;

    // In serverless production: use console.log (goes to Vercel logs)
    // In development: write to file + console
    if (isServerless && config.nodeEnv !== 'development') {
      // Vercel: log to stdout for persistent logs
      console.log(logLine);
    } else if (this.canWriteToFile) {
      // Local: write to file
      this.rotateIfNeeded();
      try {
        fs.appendFileSync(this.logFile, logLine + '\n');
        this.currentSize += Buffer.byteLength(logLine + '\n', 'utf8');
      } catch {
        // Fallback to console
        console.log(logLine);
      }
    }

    // Always output to console in development
    if (config.nodeEnv === 'development') {
      console.log(`[${level}]`, message, ...args);
    }
  }

  info(message: string, ...args: any[]) {
    this.write('INFO', message, ...args);
  }

  warn(message: string, ...args: any[]) {
    this.write('WARN', message, ...args);
  }

  error(message: string, ...args: any[]) {
    this.write('ERROR', message, ...args);
  }

  debug(message: string, ...args: any[]) {
    if (config.debug) {
      this.write('DEBUG', message, ...args);
    }
  }
}

export const logger = new CircularFileLogger();
