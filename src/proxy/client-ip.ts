/**
 * Client IP Utilities
 *
 * Neutral home for client-IP helpers shared by both proxy stacks. Lives in
 * its own module so the HTTP proxy does not have to import from the SOCKS5
 * server (or vice versa) for what is plainly an IP utility.
 *
 * @module proxy/client-ip
 */

import { randomUUID } from 'node:crypto';
import { log } from '../logger/log.js';

/**
 * Resolve a client IP for rate-limit-bucket assignment.
 *
 * Exported for unit tests (P1-1 — empty-clientIp DoS bucket) so the
 * synthetic-bucket logic can be exercised without a real TCP socket. The
 * production code path is the same as the inline call sites in
 * `socks5.handleConnection` and `http-proxy.handleConnect`.
 */
export function resolveBucketClientIp(rawClientIp: string): string {
  if (rawClientIp) return rawClientIp;
  const synthetic = `__unknown_${randomUUID()}`;
  log.warn('[proxy] no client IP — using synthetic bucket', synthetic);
  return synthetic;
}
