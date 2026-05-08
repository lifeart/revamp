/**
 * Certificate generation for HTTPS interception
 * Creates CA certificate and per-domain certificates on the fly
 *
 * @module certs
 */

import forge from 'node-forge';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { getConfig } from '../config/index.js';
import {
  CERT_CACHE_TTL_MS,
  KEY_FILE_MODE,
  POSIX_PLATFORMS,
  RATE_LIMIT_MAX,
  RATE_LIMIT_WINDOW_MS,
  certCache,
  mintTimestampsByIp,
  state,
} from './internals.js';
import type { CertificatePair } from './types.js';

// =============================================================================
// State
// =============================================================================

/** CA private key (loaded on first use) */
let caKey: forge.pki.rsa.PrivateKey | null = null;

/** CA certificate (loaded on first use) */
let caCert: forge.pki.Certificate | null = null;

// =============================================================================
// Errors
// =============================================================================

/**
 * Thrown when a client exceeds the cert minting rate limit.
 */
export class CertRateLimitError extends Error {
  constructor(public readonly clientIp: string) {
    super(`Cert minting rate limit exceeded for ${clientIp}`);
    this.name = 'CertRateLimitError';
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Ensure certificate directory exists
 */
function ensureCertDir(): void {
  const config = getConfig();
  if (!existsSync(config.certDir)) {
    mkdirSync(config.certDir, { recursive: true });
  }
}

function isPosix(): boolean {
  return POSIX_PLATFORMS.has(process.platform);
}

/**
 * Write a private key file with restrictive permissions (0600).
 * On POSIX, verifies the mode after write and re-applies chmod if necessary.
 */
function writeKeyFileSecure(path: string, contents: string): void {
  writeFileSync(path, contents, { mode: KEY_FILE_MODE });
  if (!isPosix()) {
    return;
  }
  const observed = statSync(path).mode & 0o777;
  if (observed !== KEY_FILE_MODE) {
    chmodSync(path, KEY_FILE_MODE);
  }
}

/**
 * Prune entries with an `expiresAt` <= now.
 *
 * NOTE: Map insertion order matches recency-of-touch (we re-insert on `get`),
 * but `expiresAt` is refreshed on touch too — so cycling old + new entries
 * still keeps Map-order roughly aligned with expiry order. We deliberately
 * iterate the whole Map (no early break) to stay correct even if that
 * invariant ever drifts.
 */
function pruneExpiredCacheEntries(now: number): void {
  for (const [key, entry] of certCache) {
    if (entry.expiresAt <= now) {
      certCache.delete(key);
    }
  }
}

function getCachedCert(domain: string): CertificatePair | null {
  const entry = certCache.get(domain);
  if (!entry) return null;
  const now = Date.now();
  if (entry.expiresAt <= now) {
    certCache.delete(domain);
    return null;
  }
  // Refresh TTL on touch (extend lifetime on use) and re-insert to keep
  // recency-of-touch ordering for LRU eviction. Without the refresh, an
  // entry could sit at the tail with a stale expiry while still being
  // actively used — see code-review round 1, P1 #5.
  entry.expiresAt = now + CERT_CACHE_TTL_MS;
  certCache.delete(domain);
  certCache.set(domain, entry);
  return entry.pair;
}

function setCachedCert(domain: string, pair: CertificatePair): void {
  const now = Date.now();
  pruneExpiredCacheEntries(now);
  if (certCache.has(domain)) {
    certCache.delete(domain);
  }
  certCache.set(domain, { pair, expiresAt: now + CERT_CACHE_TTL_MS });
  while (certCache.size > state.certCacheMax) {
    const oldestKey = certCache.keys().next().value;
    if (oldestKey === undefined) break;
    certCache.delete(oldestKey);
  }
}

/**
 * Drop entries from `mintTimestampsByIp` whose newest timestamp is outside
 * the rate-limit window — i.e. clients that have been quiet long enough that
 * their previous mints can no longer count against the limit.
 */
function gcStaleMintTimestamps(now: number): void {
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  for (const [ip, timestamps] of mintTimestampsByIp) {
    if (timestamps.length === 0) {
      mintTimestampsByIp.delete(ip);
      continue;
    }
    const newest = timestamps[timestamps.length - 1];
    if (newest <= windowStart) {
      mintTimestampsByIp.delete(ip);
    }
  }
}

/**
 * Enforce a sliding-window rate limit on cert minting per client IP.
 * Throws CertRateLimitError when the limit is exceeded.
 */
function enforceMintRateLimit(clientIp: string): void {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const existing = mintTimestampsByIp.get(clientIp) ?? [];
  const recent = existing.filter((ts) => ts > windowStart);
  if (recent.length >= RATE_LIMIT_MAX) {
    mintTimestampsByIp.set(clientIp, recent);
    throw new CertRateLimitError(clientIp);
  }
  recent.push(now);
  if (recent.length === 0) {
    // Defensive: if we somehow ended up empty, drop the IP entirely.
    mintTimestampsByIp.delete(clientIp);
  } else {
    mintTimestampsByIp.set(clientIp, recent);
  }

  // Periodic GC: every Nth successful mint, prune entries whose newest
  // timestamp is older than the rate-limit window. Cheap amortised cost.
  state.mintCounter++;
  if (state.mintCounter % state.mintGcInterval === 0) {
    gcStaleMintTimestamps(now);
  }
}

// =============================================================================
// CA Certificate Functions
// =============================================================================

/**
 * Generate the CA (Certificate Authority) certificate.
 * This needs to be installed on the client device to trust our proxy.
 *
 * @returns Certificate key-pair in PEM format
 */
export function generateCA(): CertificatePair {
  const config = getConfig();
  ensureCertDir();

  const caKeyPath = join(config.certDir, config.caKeyFile);
  const caCertPath = join(config.certDir, config.caCertFile);

  // Check if CA already exists
  if (existsSync(caKeyPath) && existsSync(caCertPath)) {
    const keyPem = readFileSync(caKeyPath, 'utf-8');
    const certPem = readFileSync(caCertPath, 'utf-8');

    caKey = forge.pki.privateKeyFromPem(keyPem);
    caCert = forge.pki.certificateFromPem(certPem);

    if (isPosix()) {
      const observed = statSync(caKeyPath).mode & 0o777;
      if (observed !== KEY_FILE_MODE) {
        chmodSync(caKeyPath, KEY_FILE_MODE);
      }
    }

    return { key: keyPem, cert: certPem };
  }

  console.log('🔐 Generating new CA certificate...');

  // Generate new CA
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();

  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);

  const attrs = [
    { name: 'commonName', value: 'Revamp Proxy CA' },
    { name: 'countryName', value: 'US' },
    { name: 'organizationName', value: 'Revamp' },
    { name: 'organizationalUnitName', value: 'Revamp Proxy' },
  ];

  cert.setSubject(attrs);
  cert.setIssuer(attrs);

  cert.setExtensions([
    {
      name: 'basicConstraints',
      cA: true,
      critical: true,
    },
    {
      name: 'keyUsage',
      keyCertSign: true,
      digitalSignature: true,
      cRLSign: true,
      critical: true,
    },
    {
      name: 'subjectKeyIdentifier',
    },
  ]);

  // Self-sign the CA certificate
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
  const certPem = forge.pki.certificateToPem(cert);

  // Save to disk - private key with restrictive 0600 permissions
  writeKeyFileSecure(caKeyPath, keyPem);
  writeFileSync(caCertPath, certPem);

  caKey = keys.privateKey;
  caCert = cert;

  console.log(`✅ CA certificate saved to: ${caCertPath}`);
  console.log('📱 Install this certificate on your device to trust the proxy');

  return { key: keyPem, cert: certPem };
}

// =============================================================================
// Domain Certificate Functions
// =============================================================================

/**
 * Generate a certificate for a specific domain, signed by our CA.
 * Results are cached (LRU, TTL-bounded) for performance.
 *
 * @param domain - Domain name to generate certificate for
 * @param clientIp - Optional client IP for rate limiting (omit to bypass)
 * @returns Certificate key-pair in PEM format
 * @throws {CertRateLimitError} when the client exceeds the mint rate limit
 */
export function generateDomainCert(domain: string, clientIp?: string): CertificatePair {
  const cached = getCachedCert(domain);
  if (cached) {
    return cached;
  }

  if (clientIp) {
    enforceMintRateLimit(clientIp);
  }

  // Ensure CA is loaded
  if (!caKey || !caCert) {
    generateCA();
  }

  if (!caKey || !caCert) {
    throw new Error('CA not initialized');
  }

  // Generate domain certificate
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();

  cert.publicKey = keys.publicKey;
  cert.serialNumber = Date.now().toString(16);
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

  const attrs = [
    { name: 'commonName', value: domain },
    { name: 'organizationName', value: 'Revamp' },
  ];

  cert.setSubject(attrs);
  cert.setIssuer(caCert.subject.attributes);

  cert.setExtensions([
    {
      name: 'basicConstraints',
      cA: false,
    },
    {
      name: 'keyUsage',
      digitalSignature: true,
      keyEncipherment: true,
    },
    {
      name: 'extKeyUsage',
      serverAuth: true,
    },
    {
      name: 'subjectAltName',
      altNames: [
        { type: 2, value: domain }, // DNS
        { type: 2, value: `*.${domain}` }, // Wildcard
      ],
    },
  ]);

  // Sign with CA key
  cert.sign(caKey, forge.md.sha256.create());

  const result: CertificatePair = {
    key: forge.pki.privateKeyToPem(keys.privateKey),
    cert: forge.pki.certificateToPem(cert),
  };

  // Per-domain certificates intentionally never touch disk: they are
  // ephemeral, cached in-memory, and rotated on restart. The threat model
  // for T7 is "CA private key on disk is sensitive" — see CHANGELOG.
  setCachedCert(domain, result);

  return result;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Get the CA certificate for installation on client devices.
 *
 * @returns CA certificate in PEM format
 * @throws Error if CA is not initialized
 */
export function getCACert(): string {
  if (!caCert) {
    generateCA();
  }

  if (!caCert) {
    throw new Error('CA not initialized');
  }

  return forge.pki.certificateToPem(caCert);
}

/**
 * Clear the certificate cache.
 */
export function clearCertCache(): void {
  certCache.clear();
}

/**
 * Reset all rate-limit windows (test/utility helper).
 */
export function resetCertRateLimits(): void {
  mintTimestampsByIp.clear();
  state.mintCounter = 0;
}
