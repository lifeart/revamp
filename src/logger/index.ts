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
