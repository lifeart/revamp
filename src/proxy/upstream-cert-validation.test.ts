/**
 * Upstream certificate validation tests (T8).
 *
 * Verifies the proxy's HTTP-side `proxyRequest` rejects upstream traffic with
 * an invalid TLS certificate by default and surfaces an explanatory 502 page.
 * Also verifies that the `allowInsecureUpstream` config flag re-enables the
 * legacy insecure behavior for users who knowingly opt in.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createServer as createHttpServer,
  request as httpRequest,
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import { proxyRequest } from './http-proxy.js';
import { resetConfig, updateConfig } from '../config/index.js';
import { resetMetrics } from '../metrics/index.js';
import forge from 'node-forge';

interface ProxyResult {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

let httpsServer: HttpsServer;
let httpsPort: number;
let driverServer: HttpServer;
let driverPort: number;

function generateUntrustedSelfSignedCert(): { key: string; cert: string } {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '02';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
  const attrs = [
    { name: 'commonName', value: 'untrusted.localhost' },
    { name: 'organizationName', value: 'Revamp Test Untrusted' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }] },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    key: forge.pki.privateKeyToPem(keys.privateKey),
    cert: forge.pki.certificateToPem(cert),
  };
}

function createUpstreamHandler() {
  return (_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('upstream-ok');
  };
}

/**
 * Local driver server: receives ordinary HTTP requests and immediately invokes
 * `proxyRequest` against the self-signed HTTPS upstream, without going through
 * the production CONNECT-tunnel/CertGen path.
 */
function createDriverHandler() {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const targetUrl = `https://localhost:${httpsPort}/`;
    try {
      await proxyRequest(req, res, targetUrl, true);
    } catch (err) {
      // proxyRequest already responds with the 502 page; surface the throw
      // for visibility per CLAUDE.md "no silent error swallowing".
      console.warn('[test] proxyRequest threw:', err);
    }
  };
}

function makeRequest(headers: Record<string, string>): Promise<ProxyResult> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port: driverPort,
        path: '/',
        method: 'GET',
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf-8'),
          })
        );
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('Upstream certificate validation (T8)', () => {
  beforeAll(async () => {
    const { key, cert } = generateUntrustedSelfSignedCert();
    httpsServer = createHttpsServer({ key, cert }, createUpstreamHandler());
    await new Promise<void>((resolve) =>
      httpsServer.listen(0, '127.0.0.1', () => {
        const addr = httpsServer.address();
        httpsPort = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      })
    );

    driverServer = createHttpServer(createDriverHandler());
    await new Promise<void>((resolve) =>
      driverServer.listen(0, '127.0.0.1', () => {
        const addr = driverServer.address();
        driverPort = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      })
    );
  }, 30_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => httpsServer.close(() => resolve()));
    await new Promise<void>((resolve) => driverServer.close(() => resolve()));
  });

  beforeEach(() => {
    resetConfig();
    resetMetrics();
  });

  it('returns a 502 HTML page by default when upstream cert is untrusted', async () => {
    const result = await makeRequest({ Accept: 'text/html,application/xhtml+xml' });
    expect(result.statusCode).toBe(502);
    const contentType = result.headers['content-type'];
    expect(Array.isArray(contentType) ? contentType[0] : contentType).toMatch(/text\/html/);
    expect(result.body.toLowerCase()).toContain('upstream certificate failed validation');
    expect(result.body.toLowerCase()).toContain('localhost');
  });

  it('returns a plain-text 502 when client does not accept HTML', async () => {
    const result = await makeRequest({ Accept: 'application/json' });
    expect(result.statusCode).toBe(502);
    const contentType = result.headers['content-type'];
    expect(Array.isArray(contentType) ? contentType[0] : contentType).toMatch(/text\/plain/);
    expect(result.body.toLowerCase()).toContain('upstream certificate failed validation');
  });

  it('passes through to upstream when allowInsecureUpstream opt-in is set', async () => {
    updateConfig({ allowInsecureUpstream: true });
    const result = await makeRequest({ Accept: '*/*' });
    expect(result.statusCode).toBe(200);
    expect(result.body).toBe('upstream-ok');
  });
});
