/**
 * JSON Request Logger
 *
 * Logs application/json requests (request headers, response headers, content)
 * to a structured folder hierarchy:
 * [user_ip]/[domain]/[dd.mm.ss]/[path].json
 *
 * Each log file contains:
 * - url: Full URL with query parameters
 * - timestamp: ISO timestamp of the request
 * - requestHeaders: All request headers
 * - requestBody: Request body (for POST/PUT/PATCH requests)
 * - responseHeaders: All response headers
 * - data: Decoded JSON response body
 *
 * @module logger/json-request-logger
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { URL } from 'node:url';
import { getConfig } from '../config/index.js';

/**
 * Structure of a logged JSON request
 */
export interface JsonRequestLog {
  /** Full URL with query parameters */
  url: string;
  /** ISO timestamp of the request */
  timestamp: string;
  /** Request headers */
  requestHeaders: Record<string, string | string[] | undefined>;
  /** Request body (for POST/PUT/PATCH requests) */
  requestBody?: unknown;
  /** Response headers */
  responseHeaders: Record<string, string | string[] | undefined>;
  /** Decoded JSON response data */
  data: unknown;
}

/**
 * Check if response content type is application/json
 *
 * @param contentType - Content-Type header value
 * @returns true if content type indicates JSON
 */
export function isJsonContentType(contentType: string | string[] | undefined): boolean {
  if (!contentType) return false;
  const ct = Array.isArray(contentType) ? contentType[0] : contentType;
  return ct.toLowerCase().includes('application/json');
}

/**
 * Sanitize a string to be safe for use in file/folder names
 * Replaces problematic characters with underscores
 *
 * @param str - String to sanitize
 * @returns Sanitized string safe for filesystem use
 */
function sanitizeForFilename(str: string): string {
  // Replace characters that are problematic in filenames
  return str
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 200); // Limit length to avoid path issues
}

/**
 * Generate a timestamp string in dd.mm.ss format for folder names
 *
 * @param date - Date object
 * @returns Formatted timestamp string (dd.mm.ss)
 */
function getTimeFolder(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`;
}

/**
 * Generate a date string in yyyy-mm-dd format for folder names
 *
 * @param date - Date object
 * @returns Formatted date string (yyyy-mm-dd)
 */
function getDateFolder(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Build the log file path for a JSON request
 *
 * Structure: [baseDir]/[user_ip]/[domain]/[date]/[time]/[path].json
 *
 * @param baseDir - Base directory for logs
 * @param clientIp - Client IP address
 * @param url - Full request URL
 * @param timestamp - Request timestamp
 * @returns Object containing directory path and filename
 */
function buildLogPath(
  baseDir: string,
  clientIp: string,
  url: string,
  timestamp: Date
): { dir: string; filename: string } {
  const parsedUrl = new URL(url);
  const domain = sanitizeForFilename(parsedUrl.hostname);
  const sanitizedIp = sanitizeForFilename(clientIp);
  const dateFolder = getDateFolder(timestamp);
  const timeFolder = getTimeFolder(timestamp);

  // Build path from URL pathname, removing leading slash and replacing remaining slashes
  let pathPart = parsedUrl.pathname.replace(/^\//, '') || 'index';
  pathPart = sanitizeForFilename(pathPart.replace(/\//g, '_'));

  // Add a unique suffix to avoid collisions
  const uniqueSuffix = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);

  const dir = join(baseDir, sanitizedIp, domain, dateFolder, timeFolder);
  const filename = `${pathPart}_${uniqueSuffix}.json`;

  return { dir, filename };
}

/**
 * Log a JSON request to the filesystem
 *
 * Creates the directory structure if it doesn't exist and writes the log file.
 * Silently fails if logging is disabled or encounters errors (non-blocking).
 *
 * @param clientIp - Client IP address
 * @param url - Full request URL with query parameters
 * @param requestHeaders - Request headers
 * @param responseHeaders - Response headers
 * @param responseBody - Response body (will be parsed as JSON)
 * @param requestBody - Optional request body (for POST/PUT/PATCH requests)
 */
export async function logJsonRequest(
  clientIp: string,
  url: string,
  requestHeaders: Record<string, string | string[] | undefined>,
  responseHeaders: Record<string, string | string[] | undefined>,
  responseBody: Buffer | string,
  requestBody?: Buffer | string
): Promise<void> {
  const config = getConfig();

  // Check if JSON logging is enabled
  if (!config.logJsonRequests) {
    return;
  }

  try {
    const timestamp = new Date();
    const { dir, filename } = buildLogPath(config.jsonLogDir, clientIp, url, timestamp);

    // Parse the response body as JSON
    let data: unknown;
    try {
      const bodyStr = typeof responseBody === 'string'
        ? responseBody
        : responseBody.toString('utf-8');
      data = JSON.parse(bodyStr);
    } catch {
      // If parsing fails, store as raw string
      data = typeof responseBody === 'string'
        ? responseBody
        : responseBody.toString('utf-8');
    }

    // Parse the request body if provided
    let parsedRequestBody: unknown = undefined;
    if (requestBody && (typeof requestBody === 'string' ? requestBody.length > 0 : requestBody.length > 0)) {
      try {
        const reqBodyStr = typeof requestBody === 'string'
          ? requestBody
          : requestBody.toString('utf-8');
        parsedRequestBody = JSON.parse(reqBodyStr);
      } catch {
        // If parsing fails, store as raw string
        parsedRequestBody = typeof requestBody === 'string'
          ? requestBody
          : requestBody.toString('utf-8');
      }
    }

    // Build the log entry
    const logEntry: JsonRequestLog = {
      url,
      timestamp: timestamp.toISOString(),
      requestHeaders,
      ...(parsedRequestBody !== undefined && { requestBody: parsedRequestBody }),
      responseHeaders,
      data,
    };

    // Create directory structure
    await mkdir(dir, { recursive: true });

    // Write log file
    const logPath = join(dir, filename);
    await writeFile(logPath, JSON.stringify(logEntry, null, 2), 'utf-8');

    console.log(`📝 JSON logged: ${logPath}`);
  } catch (err) {
    // Log error but don't fail the request
    console.error(`❌ Failed to log JSON request: ${err}`);
  }
}

/**
 * Check if a request should be logged based on response content type
 *
 * @param responseHeaders - Response headers
 * @returns true if the response is JSON and should be logged
 */
export function shouldLogJsonRequest(
  responseHeaders: Record<string, string | string[] | undefined>
): boolean {
  const config = getConfig();
  if (!config.logJsonRequests) {
    return false;
  }
  return isJsonContentType(responseHeaders['content-type']);
}
