/**
 * Logger Module
 *
 * Exports logging utilities for the proxy server.
 *
 * @module logger
 */

export {
  logJsonRequest,
  shouldLogJsonRequest,
  isJsonContentType,
  type JsonRequestLog,
} from './json-request-logger.js';

export { sanitizeForLog } from './sanitize.js';

export {
  log,
  setLogLevel,
  getLogLevel,
  setLoggerBackend,
  consoleLoggerBackend,
  isLogLevel,
  LOG_LEVELS,
  type LogLevel,
  type LoggerBackend,
} from './log.js';
