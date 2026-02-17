/**
 * Simple logging utility with log levels
 */

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

const logLevelMap: Record<string, LogLevel> = {
  error: LogLevel.ERROR,
  warn: LogLevel.WARN,
  info: LogLevel.INFO,
  debug: LogLevel.DEBUG,
};

// Get log level from environment, default to INFO
const currentLevel = logLevelMap[process.env.LOG_LEVEL?.toLowerCase() || 'info'] ?? LogLevel.INFO;

function shouldLog(level: LogLevel): boolean {
  return level <= currentLevel;
}

function formatMessage(level: string, component: string, message: string, meta?: unknown): string {
  const timestamp = new Date().toISOString();
  const metaStr = meta !== undefined ? ` ${JSON.stringify(meta)}` : '';
  return `${timestamp} [${level}] [${component}] ${message}${metaStr}`;
}

export const logger = {
  error(component: string, message: string, meta?: unknown): void {
    if (shouldLog(LogLevel.ERROR)) {
      console.error(formatMessage('ERROR', component, message, meta));
    }
  },

  warn(component: string, message: string, meta?: unknown): void {
    if (shouldLog(LogLevel.WARN)) {
      console.warn(formatMessage('WARN', component, message, meta));
    }
  },

  info(component: string, message: string, meta?: unknown): void {
    if (shouldLog(LogLevel.INFO)) {
      console.log(formatMessage('INFO', component, message, meta));
    }
  },

  debug(component: string, message: string, meta?: unknown): void {
    if (shouldLog(LogLevel.DEBUG)) {
      console.log(formatMessage('DEBUG', component, message, meta));
    }
  },
};
