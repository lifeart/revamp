/**
 * Upstream WebSocket TLS certificate validation tests (T8 — round-1 fix).
 *
 * The HTTPS interceptor's `fakeServer.on('upgrade')` handler used to hardcode
 * `rejectUnauthorized: false` when piping a `wss://` upgrade through to the
 * upstream — exactly the MITM-laundering vector T8 was supposed to close.
 *
 * This test exercises `forwardWebSocketUpgrade` directly with:
 *   - default config              -> upstream cert validation ON  -> NO 101 reply
 *   - `allowInsecureUpstream:true` -> validation skipped           -> 101 reply
 *
 * Driver topology:
 *
 *     [dialer socket] <==TCP==> [accepted socket]
 *                                       │
 *                                       └─ passed to forwardWebSocketUpgrade
 *                                          which TLS-connects to `httpsServer`
 *                                          and pipes bytes back over the
 *                                          accepted socket → dialer.
 *
 * We assert on bytes the *dialer* sees: that's what an iPad client would
 * see in production through the CONNECT tunnel.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createServer as createHttpsServer,
  type Server as HttpsServer,
} from 'node:https';
import {
  createServer as createNetServer,
  connect as netConnect,
  type Server as NetServer,
  type Socket,
} from 'node:net';
import type { IncomingMessage } from 'node:http';
import { Buffer } from 'node:buffer';
import { WebSocketServer } from 'ws';
import forge from 'node-forge';
import { resetConfig, updateConfig } from '../config/index.js';
import { forwardWebSocketUpgrade } from './http-proxy.js';

let httpsServer: HttpsServer;
let httpsPort: number;
let bridgeServer: NetServer;
let bridgePort: number;

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

function makeFakeUpgradeRequest(): IncomingMessage {
  const fake = {
    method: 'GET',
    url: '/',
    headers: {
      host: `localhost:${httpsPort}`,
      upgrade: 'websocket',
      connection: 'Upgrade',
      'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
      'sec-websocket-version': '13',
    },
  };
  return fake as unknown as IncomingMessage;
}

interface UpgradeResult {
  /** Bytes the dialer (client) saw before close/timeout. */
  bytes: Buffer;
  /** Convenience: parsed status line, e.g. `HTTP/1.1 101 Switching Protocols`. */
  statusLine: string;
}

/**
 * Open one TCP connection through the bridge. The bridge-accepted socket is
 * fed into `forwardWebSocketUpgrade` as the "iPad-side" socket. The proxy
 * then writes the upstream's response back through that socket to the
 * dialer; we observe bytes on the dialer.
 */
async function driveUpgradeAndCollect(timeoutMs = 6000): Promise<UpgradeResult> {
  return await new Promise<UpgradeResult>((resolve) => {
    let settled = false;
    let captured: Socket | null = null;
    let acceptedHandled = false;
    const chunks: Buffer[] = [];

    const finish = (): void => {
      if (settled) return;
      settled = true;
      const bytes = Buffer.concat(chunks);
      const newline = bytes.indexOf('\r\n');
      const statusLine = newline > 0 ? bytes.subarray(0, newline).toString('utf-8') : '';
      bridgeServer.off('connection', onConn);
      if (captured && !captured.destroyed) captured.destroy();
      if (!dialer.destroyed) dialer.destroy();
      resolve({ bytes, statusLine });
    };

    const timer = setTimeout(finish, timeoutMs);

    const onConn = (clientSide: Socket) => {
      if (acceptedHandled) return;
      acceptedHandled = true;
      captured = clientSide;
      clientSide.on('error', () => {
        // Suppress: TLS rejection from upstream may close mid-write.
      });

      const fakeReq = makeFakeUpgradeRequest();
      forwardWebSocketUpgrade(
        fakeReq,
        clientSide,
        Buffer.alloc(0),
        'localhost',
        httpsPort
      );
    };

    bridgeServer.on('connection', onConn);

    const dialer = netConnect(bridgePort, '127.0.0.1');
    dialer.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      const buf = Buffer.concat(chunks);
      if (buf.indexOf('\r\n\r\n') >= 0) {
        clearTimeout(timer);
        // Allow any trailing bytes to flush before resolving.
        setImmediate(finish);
      }
    });
    dialer.on('close', () => {
      clearTimeout(timer);
      finish();
    });
    dialer.on('error', () => {
      // Suppress dialer errors; the test settles via timer/data/close.
    });
  });
}

describe('Upstream WebSocket cert validation (T8 / fakeServer upgrade)', () => {
  beforeAll(async () => {
    const { key, cert } = generateUntrustedSelfSignedCert();
    httpsServer = createHttpsServer({ key, cert });
    const wss = new WebSocketServer({ server: httpsServer });
    wss.on('connection', (ws) => {
      ws.send('upstream-ok');
    });
    await new Promise<void>((resolve) =>
      httpsServer.listen(0, '127.0.0.1', () => {
        const addr = httpsServer.address();
        httpsPort = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      })
    );

    bridgeServer = createNetServer();
    await new Promise<void>((resolve) =>
      bridgeServer.listen(0, '127.0.0.1', () => {
        const addr = bridgeServer.address();
        bridgePort = typeof addr === 'object' && addr ? addr.port : 0;
        resolve();
      })
    );
  }, 30_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => httpsServer.close(() => resolve()));
    await new Promise<void>((resolve) => bridgeServer.close(() => resolve()));
  });

  beforeEach(() => {
    resetConfig();
  });

  it('does NOT issue a 101 Switching Protocols when upstream cert is untrusted', async () => {
    const result = await driveUpgradeAndCollect();
    expect(result.statusLine).not.toMatch(/^HTTP\/1\.1 101 /);
    if (result.statusLine) {
      expect(result.statusLine).toMatch(/^HTTP\/1\.1 502 /);
      expect(result.bytes.toString('utf-8').toLowerCase()).toContain(
        'upstream certificate failed validation'
      );
    }
  }, 30_000);

  it('completes the upgrade (101) when allowInsecureUpstream is true', async () => {
    updateConfig({ allowInsecureUpstream: true });
    const result = await driveUpgradeAndCollect();
    expect(result.statusLine).toMatch(/^HTTP\/1\.1 101 /);
    expect(result.bytes.toString('utf-8').toLowerCase()).toContain('upgrade: websocket');
  }, 30_000);
});
