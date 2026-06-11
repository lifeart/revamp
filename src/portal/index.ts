/**
 * Captive Portal Server
 * Serves a webpage for downloading and installing the CA certificate
 * Useful for iOS devices that need to trust the proxy certificate
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { log } from '../logger/log.js';
import { getCACert } from '../certs/index.js';
import { getConfig } from '../config/index.js';
import { networkInterfaces } from 'node:os';
import { handleRevampRequest, isRevampEndpoint } from '../proxy/revamp-api.js';
import { loadTemplate, renderTemplate } from '../util/template.js';

// Get local IP addresses
function getLocalIPs(): string[] {
  const nets = networkInterfaces();
  const ips: string[] = [];

  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }

  return ips;
}

/**
 * Detect iOS version family from User-Agent for T21 trust-instruction copy.
 *
 * Returns:
 *   - `'pre-trust-settings'` for iOS 9–10 (Trust Settings UI did not exist —
 *     CA trust is implicit on profile install).
 *   - `'trust-settings'` for iOS 10.3+ (the user must enable full trust under
 *     Settings → General → About → Certificate Trust Settings; iOS 12.2 hardened
 *     this further but the same UI applies).
 *   - `'unknown'` for non-iOS / unparsed UAs — fall back to the modern copy.
 *
 * Exported for unit tests.
 */
export type IosTrustVariant = 'pre-trust-settings' | 'trust-settings' | 'unknown';

export function detectIosTrustVariant(userAgent: string | undefined): IosTrustVariant {
  if (!userAgent) return 'unknown';
  const match = /\b(?:iPhone|iPad|iPod);[^)]*\bOS\s+(\d+)(?:_(\d+))?/i.exec(userAgent);
  if (!match) return 'unknown';
  const major = parseInt(match[1], 10);
  if (!Number.isFinite(major)) return 'unknown';
  // iOS 9 and 10.0–10.2 had no Trust Settings UI — installing the profile
  // grants full trust outright. Trust Settings shipped in 10.3.
  if (major < 10) return 'pre-trust-settings';
  if (major === 10) {
    const minor = parseInt(match[2] || '0', 10);
    if (!Number.isFinite(minor) || minor < 3) return 'pre-trust-settings';
  }
  return 'trust-settings';
}

/**
 * Render the iOS install instructions block (T21). On iOS 9 / 10.0–10.2 the
 * profile install grants trust implicitly; later versions require an extra
 * Trust Settings step.
 */
function renderIosInstructions(variant: IosTrustVariant): string {
  const file =
    variant === 'pre-trust-settings'
      ? './templates/ios-instructions-pre-trust.html'
      : './templates/ios-instructions-trust-settings.html';
  return loadTemplate(new URL(file, import.meta.url));
}

// HTML template for the captive portal
export function getPortalHTML(localIP: string, portalPort: number, userAgent?: string): string {
  const config = getConfig();
  const trustVariant = detectIosTrustVariant(userAgent);

  return renderTemplate(loadTemplate(new URL('./templates/portal.html', import.meta.url)), {
    localIP,
    portalPort,
    socks5Port: config.socks5Port,
    httpProxyPort: config.httpProxyPort,
    iosInstructions: renderIosInstructions(trustVariant),
  });
}

/**
 * Read the request body to a string for the admin POST/PUT routes.
 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

/**
 * T23: delegate `/__revamp__/*` requests on the portal port to the same
 * admin/api handlers used by the proxy (`handleRevampRequest`). Reuses, does
 * not fork. Intentionally mounted on the portal port so the admin UI is
 * reachable without a configured proxy — the catch-22 case where setup is
 * broken and the user cannot get to the admin panel through the proxy.
 */
async function handleRevampOnPortal(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const method = req.method || 'GET';
    const url = req.url || '/';
    const clientIp = (req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
    const body = method === 'GET' || method === 'HEAD' ? '' : await readBody(req);
    const result = await handleRevampRequest(url, method, body, clientIp);

    for (const [key, value] of Object.entries(result.headers)) {
      res.setHeader(key, value);
    }
    res.writeHead(result.statusCode);
    res.end(result.body);
  } catch (err) {
    log.error('[portal] admin route error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  }
}

/**
 * Internal request handler. Exported for unit tests so admin-mount routes
 * can be exercised without binding a real port (T23).
 */
export async function handlePortalRequest(
  req: IncomingMessage,
  res: ServerResponse,
  primaryIP: string,
  port: number
): Promise<void> {
  const url = req.url || '/';
  const userAgentRaw = req.headers['user-agent'] as string | string[] | undefined;
  const userAgentStr: string | undefined = Array.isArray(userAgentRaw)
    ? userAgentRaw[0]
    : userAgentRaw;

  // T23: forward admin / API endpoints to the shared revamp-api handler so
  // the admin panel works even when the proxy isn't configured yet.
  if (isRevampEndpoint(url.split('?')[0])) {
    await handleRevampOnPortal(req, res);
    return;
  }

  // Serve the CA certificate
  if (url === '/cert/revamp-ca.crt' || url === '/cert' || url === '/certificate') {
    try {
      const cert = getCACert();
      res.writeHead(200, {
        'Content-Type': 'application/x-x509-ca-cert',
        'Content-Disposition': 'attachment; filename="revamp-ca.crt"',
        'Content-Length': Buffer.byteLength(cert),
        'Cache-Control': 'no-cache',
      });
      res.end(cert);
      log.info(`📜 Certificate downloaded from ${req.socket.remoteAddress}`);
      return;
    } catch (err) {
      log.error('[portal] cert serve error:', err);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error generating certificate');
      return;
    }
  }

  // Serve the portal page for iOS captive portal detection
  if (
    url === '/hotspot-detect.html' ||
    url === '/library/test/success.html' ||
    url === '/success.txt' ||
    url === '/generate_204' ||
    url === '/gen_204'
  ) {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.end(getPortalHTML(primaryIP, port, userAgentStr));
    return;
  }

  // Default: serve the portal page
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache',
  });
  res.end(getPortalHTML(primaryIP, port, userAgentStr));
}

/**
 * Create and start the captive portal server
 */
export function createCaptivePortal(port: number, bindAddress: string = '0.0.0.0'): Server {
  const localIPs = getLocalIPs();
  const primaryIP = localIPs[0] || '127.0.0.1';

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handlePortalRequest(req, res, primaryIP, port);
  });

  server.on('error', (err) => {
    log.error(`❌ Captive portal error: ${err.message}`);
  });

  server.listen(port, bindAddress, () => {
    log.info(`🌐 Captive Portal listening on ${bindAddress}:${port}`);
    log.info(`   Open http://${primaryIP}:${port} on your device to install certificate`);
  });

  return server;
}
