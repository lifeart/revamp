/**
 * HTTP Request Utilities
 *
 * Shared HTTP/HTTPS request functions for proxy implementations.
 * Handles content transformation, decompression, and header manipulation.
 */

import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { getConfig } from '../config/index.js';
import { markAsRedirect, isRedirectStatus } from '../cache/index.js';
import { transformImage, needsImageTransform } from '../transformers/image.js';
import {
  recordTransform,
  recordBandwidth,
} from '../metrics/index.js';
import {
  getCharset,
  getContentType,
  decompressBody,
  transformContent,
  SPOOFED_USER_AGENT,
} from './shared.js';
import type { HttpResponse, RequestHeaders } from './types.js';
import {
  shouldLogJsonRequest,
  logJsonRequest,
} from '../logger/json-request-logger.js';

/**
 * Make an HTTPS request to a remote server with transformation support
 *
 * @param method - HTTP method (GET, POST, etc.)
 * @param hostname - Target hostname
 * @param path - Request path including query string
 * @param headers - Request headers
 * @param body - Request body
 * @param clientIp - Optional client IP for per-client cache separation
 * @returns Promise resolving to HttpResponse with transformed content
 */
export async function makeHttpsRequest(
  method: string,
  hostname: string,
  path: string,
  headers: RequestHeaders,
  body: Buffer,
  clientIp?: string
): Promise<HttpResponse> {
  const config = getConfig();

  // Spoof User-Agent to simulate a modern browser
  const requestHeaders = { ...headers };
  if (config.spoofUserAgent && requestHeaders['user-agent']) {
    requestHeaders['user-agent'] = SPOOFED_USER_AGENT;
  }

  // Strip cache validation headers for JS/CSS files to ensure we always get
  // the full response body for transformation. Without this, the server may
  // return 304 Not Modified and the browser uses its cached (untransformed) version.
  const pathLower = path.toLowerCase();
  if (pathLower.includes('/js/') || pathLower.includes('/_/js/') ||
      pathLower.endsWith('.js') || pathLower.endsWith('.css') ||
      pathLower.includes('/css/') || pathLower.includes('/_/css/')) {
    delete requestHeaders['if-none-match'];
    delete requestHeaders['if-modified-since'];
  }

  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      port: 443,
      path,
      method,
      headers: {
        ...requestHeaders,
        // Don't request brotli - simpler to handle gzip/deflate
        'accept-encoding': 'gzip, deflate',
      },
      rejectUnauthorized: false,
    };

    const req = httpsRequest(options, async (res) => {
      const chunks: Buffer[] = [];

      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', async () => {
        try {
          const response = await processResponse(
            res,
            Buffer.concat(chunks),
            `https://${hostname}${path}`,
            clientIp,
            requestHeaders,
            body
          );
          resolve(response);
        } catch (err) {
          reject(err);
        }
      });
      res.on('error', reject);
    });

    req.on('error', reject);

    if (body.length > 0) {
      req.write(body);
    }
    req.end();
  });
}

/**
 * Make an HTTP request to a remote server with transformation support
 *
 * @param method - HTTP method (GET, POST, etc.)
 * @param hostname - Target hostname
 * @param port - Target port
 * @param path - Request path including query string
 * @param headers - Request headers
 * @param body - Request body
 * @param clientIp - Optional client IP for per-client cache separation
 * @returns Promise resolving to HttpResponse with transformed content
 */
export async function makeHttpRequest(
  method: string,
  hostname: string,
  port: number,
  path: string,
  headers: RequestHeaders,
  body: Buffer,
  clientIp?: string
): Promise<HttpResponse> {
  // Strip cache validation headers for JS/CSS files to ensure we always get
  // the full response body for transformation.
  const requestHeaders = { ...headers };
  const pathLower = path.toLowerCase();
  if (pathLower.includes('/js/') || pathLower.includes('/_/js/') ||
      pathLower.endsWith('.js') || pathLower.endsWith('.css') ||
      pathLower.includes('/css/') || pathLower.includes('/_/css/')) {
    delete requestHeaders['if-none-match'];
    delete requestHeaders['if-modified-since'];
  }

  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      port,
      path,
      method,
      headers: {
        ...requestHeaders,
        'accept-encoding': 'gzip, deflate',
      },
    };

    const req = httpRequest(options, async (res) => {
      const chunks: Buffer[] = [];

      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', async () => {
        try {
          const response = await processResponse(
            res,
            Buffer.concat(chunks),
            `http://${hostname}${path}`,
            clientIp,
            headers,
            body
          );
          resolve(response);
        } catch (err) {
          reject(err);
        }
      });
      res.on('error', reject);
    });

    req.on('error', reject);

    if (body.length > 0) {
      req.write(body);
    }
    req.end();
  });
}

/**
 * Process an HTTP response - decompress and transform content
 *
 * @param res - Node.js IncomingMessage
 * @param rawBody - Raw response body
 * @param targetUrl - Full target URL for logging and transformation
 * @param clientIp - Optional client IP for per-client cache separation
 * @param requestHeaders - Optional request headers for JSON logging
 * @param requestBody - Optional request body for JSON logging
 * @returns Processed HttpResponse
 */
async function processResponse(
  res: IncomingMessage,
  rawBody: Buffer,
  targetUrl: string,
  clientIp?: string,
  requestHeaders?: RequestHeaders,
  requestBody?: Buffer
): Promise<HttpResponse> {
  // Decompress if needed
  const encoding = res.headers['content-encoding'];
  const encodingStr = Array.isArray(encoding) ? encoding[0] : encoding;
  let responseBody: Buffer = await decompressBody(rawBody, encodingStr);
  const wasDecompressed = responseBody !== rawBody;

  // Copy headers and remove content-encoding if we decompressed
  const updatedHeaders = { ...res.headers };
  if (wasDecompressed) {
    // Decompression succeeded, remove the encoding header
    delete updatedHeaders['content-encoding'];
  }

  // Check for redirect responses (301, 302, 303, 307, 308)
  const statusCode = res.statusCode || 200;
  const isRedirect = isRedirectStatus(statusCode);

  const rawContentType = res.headers['content-type'] || '';
  const contentTypeValue = Array.isArray(rawContentType) ? rawContentType[0] : rawContentType;

  // Mark redirecting URLs so we don't cache them
  if (isRedirect) {
    markAsRedirect(targetUrl);
  }

  // Log JSON requests if enabled (before transformation)
  if (clientIp && requestHeaders && shouldLogJsonRequest(updatedHeaders)) {
    logJsonRequest(
      clientIp,
      targetUrl,
      requestHeaders,
      updatedHeaders,
      responseBody,
      requestBody
    );
  }

  // Transform content if not a redirect and has content
  if (!isRedirect && responseBody.length > 0) {
    // Transform WebP/AVIF images to JPEG for legacy browser compatibility
    // Check this BEFORE text transformation
    if (needsImageTransform(contentTypeValue, targetUrl)) {
      const imageResult = await transformImage(responseBody, contentTypeValue, targetUrl);
      if (imageResult.transformed) {
        responseBody = Buffer.from(imageResult.data);
        updatedHeaders['content-type'] = imageResult.contentType;
        recordTransform('images');
      }
    } else {
      // Transform text content (JS, CSS, HTML)
      const charset = getCharset(contentTypeValue);
      const contentType = getContentType(
        res.headers as Record<string, string | string[] | undefined>,
        targetUrl
      );

      if (contentType !== 'other') {
        const originalSize = responseBody.length;
        responseBody = Buffer.from(await transformContent(responseBody, contentType, targetUrl, charset, undefined, clientIp));
        recordTransform(contentType);

        // Update Content-Type header to UTF-8 since we converted the content
        if (updatedHeaders['content-type']) {
          const ct = Array.isArray(updatedHeaders['content-type'])
            ? updatedHeaders['content-type'][0]
            : updatedHeaders['content-type'];
          updatedHeaders['content-type'] = ct.replace(/charset=[^;\s]+/i, 'charset=UTF-8');
        }
      }
    }
  }

  // Record bandwidth metrics
  recordBandwidth(rawBody.length, responseBody.length);

  return {
    statusCode: res.statusCode || 200,
    statusMessage: res.statusMessage || 'OK',
    headers: updatedHeaders,
    body: responseBody,
  };
}
