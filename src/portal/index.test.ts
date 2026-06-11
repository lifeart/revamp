/**
 * Captive Portal Unit Tests
 *
 * Exercises the request-handler entry point exported from the portal so
 * routing and templating can be verified without binding a real port.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import {
  detectIosTrustVariant,
  getPortalHTML,
  handlePortalRequest,
} from './index.js';
import { resetConfig } from '../config/index.js';
import { resetMetrics } from '../metrics/index.js';

interface CapturedResponse {
  statusCode: number;
  headers: Record<string, string | number | string[] | undefined>;
  body: string;
}

function makeRequest(
  url: string,
  method: string = 'GET',
  headers: Record<string, string> = {}
): IncomingMessage {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.url = url;
  req.method = method;
  req.headers = headers;
  return req;
}

function captureResponse(): { res: ServerResponse; capture: () => Promise<CapturedResponse> } {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  const res = new ServerResponse(req);
  const chunks: Buffer[] = [];
  let statusCode = 0;
  const headers: Record<string, string | number | string[] | undefined> = {};

  // Wrap writeHead/setHeader/end to capture without binding a real socket.
  const origWriteHead = res.writeHead.bind(res);
  res.writeHead = (status: number, ...rest: unknown[]) => {
    statusCode = status;
    const last = rest[rest.length - 1];
    if (last && typeof last === 'object' && !Array.isArray(last)) {
      Object.assign(headers, last);
    }
    return origWriteHead(status, ...rest as []);
  };

  const origSetHeader = res.setHeader.bind(res);
  res.setHeader = (name: string, value: string | string[] | number) => {
    headers[name.toLowerCase()] = value;
    return origSetHeader(name, value);
  };

  res.write = (chunk: string | Buffer) => {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    return true;
  };

  let resolveDone: (() => void) | null = null;
  const done = new Promise<void>((r) => {
    resolveDone = r;
  });

  res.end = ((chunk?: string | Buffer) => {
    if (chunk) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    if (resolveDone) resolveDone();
    return res;
  }) as typeof res.end;

  return {
    res,
    capture: async () => {
      await done;
      return {
        statusCode,
        headers,
        body: Buffer.concat(chunks).toString('utf-8'),
      };
    },
  };
}

describe('detectIosTrustVariant (T21)', () => {
  it('returns pre-trust-settings for iOS 9 UA', () => {
    const ua =
      'Mozilla/5.0 (iPad; CPU OS 9_3_5 like Mac OS X) AppleWebKit/601.1.46 (KHTML, like Gecko) Version/9.0 Mobile/13G36 Safari/601.1';
    expect(detectIosTrustVariant(ua)).toBe('pre-trust-settings');
  });

  it('returns pre-trust-settings for iOS 10.2 UA', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 10_2 like Mac OS X) AppleWebKit/602.4.6 (KHTML, like Gecko) Version/10.0 Mobile/14C92 Safari/602.1';
    expect(detectIosTrustVariant(ua)).toBe('pre-trust-settings');
  });

  it('returns trust-settings for iOS 10.3 UA', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 10_3 like Mac OS X) AppleWebKit/603.1.30 (KHTML, like Gecko) Version/10.0 Mobile/14E5239e Safari/602.1';
    expect(detectIosTrustVariant(ua)).toBe('trust-settings');
  });

  it('returns trust-settings for iOS 13 UA', () => {
    const ua =
      'Mozilla/5.0 (iPad; CPU OS 13_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1 Mobile/15E148 Safari/604.1';
    expect(detectIosTrustVariant(ua)).toBe('trust-settings');
  });

  it('returns unknown for non-iOS UAs', () => {
    expect(detectIosTrustVariant(undefined)).toBe('unknown');
    expect(
      detectIosTrustVariant(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
      )
    ).toBe('unknown');
  });
});

describe('getPortalHTML (T21 + T22)', () => {
  beforeEach(() => {
    resetConfig();
  });
  afterEach(() => {
    resetConfig();
  });

  it('renders no Trust Settings step for iOS 9 UA', () => {
    const ua =
      'Mozilla/5.0 (iPad; CPU OS 9_3_5 like Mac OS X) AppleWebKit/601.1.46 (KHTML, like Gecko) Version/9.0 Mobile/13G36 Safari/601.1';
    const html = getPortalHTML('192.168.1.10', 8888, ua);
    expect(html).not.toContain('Certificate Trust Settings');
    expect(html).toContain('Settings → General → Profile');
  });

  it('renders both Profile and Trust Settings steps for iOS 13 UA', () => {
    const ua =
      'Mozilla/5.0 (iPad; CPU OS 13_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1 Mobile/15E148 Safari/604.1';
    const html = getPortalHTML('192.168.1.10', 8888, ua);
    expect(html).toContain('Certificate Trust Settings');
    expect(html).toContain('VPN &amp; Device Management');
  });

  it('renders the full page from the on-disk template (key landmarks present)', () => {
    const html = getPortalHTML('192.168.1.10', 8888, undefined);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html.endsWith('</html>')).toBe(true);
    expect(html).toContain('<title>Revamp Proxy - Certificate Setup</title>');
    expect(html).toContain('href="/cert/revamp-ca.crt"');
    expect(html).toContain('<ol class="instructions">');
    expect(html).toContain('Portal: http://192.168.1.10:8888');
    // No unrendered placeholders may leak into served HTML.
    expect(html).not.toContain('{{');
  });

  it('renders both PAC and Manual blocks, with PAC marked recommended (T22)', () => {
    const html = getPortalHTML('192.168.1.10', 8888, undefined);
    expect(html).toContain('Easy (PAC)');
    expect(html).toContain('Manual (SOCKS5)');
    expect(html).toContain('recommended');
    expect(html).toContain('http://192.168.1.10:8888/__revamp__/pac/socks5');

    // Ordering: the PAC tab must appear before Manual in the source so it's
    // the first/highlighted one.
    const pacIdx = html.indexOf('Easy (PAC)');
    const manualIdx = html.indexOf('Manual (SOCKS5)');
    expect(pacIdx).toBeGreaterThan(0);
    expect(manualIdx).toBeGreaterThan(pacIdx);
  });
});

describe('handlePortalRequest — admin routes mounted on portal port (T23)', () => {
  beforeEach(() => {
    resetConfig();
    resetMetrics();
  });
  afterEach(() => {
    resetConfig();
    resetMetrics();
  });

  it('serves /__revamp__/admin/index.html via the shared admin handler', async () => {
    const req = makeRequest('/__revamp__/admin/index.html');
    const { res, capture } = captureResponse();

    await handlePortalRequest(req, res, '192.168.1.10', 8888);
    const out = await capture();

    expect(out.statusCode).toBe(200);
    const ct = (out.headers['Content-Type'] || out.headers['content-type']) as string | undefined;
    expect(ct).toMatch(/text\/html/);
    // Admin index.html shipped at public/admin/index.html — confirms the
    // file actually came from disk via revamp-api.serveAdminFile.
    expect(out.body).toContain('Revamp Admin');
  });

  it('serves /__revamp__/metrics/json via the shared admin handler', async () => {
    const req = makeRequest('/__revamp__/metrics/json');
    const { res, capture } = captureResponse();

    await handlePortalRequest(req, res, '192.168.1.10', 8888);
    const out = await capture();

    expect(out.statusCode).toBe(200);
    const data = JSON.parse(out.body) as Record<string, unknown>;
    expect(data).toHaveProperty('requests');
    expect(data).toHaveProperty('hosts');
  });

  it('falls through to the portal page for non-revamp paths', async () => {
    const req = makeRequest('/');
    const { res, capture } = captureResponse();

    await handlePortalRequest(req, res, '192.168.1.10', 8888);
    const out = await capture();

    expect(out.statusCode).toBe(200);
    expect(out.body).toContain('Revamp Proxy');
  });
});
