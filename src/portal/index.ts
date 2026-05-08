/**
 * Captive Portal Server
 * Serves a webpage for downloading and installing the CA certificate
 * Useful for iOS devices that need to trust the proxy certificate
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { getCACert } from '../certs/index.js';
import { getConfig } from '../config/index.js';
import { networkInterfaces } from 'node:os';
import { handleRevampRequest, isRevampEndpoint } from '../proxy/revamp-api.js';

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
  if (variant === 'pre-trust-settings') {
    return `<ol class="instructions">
        <li>Tap the download button above</li>
        <li>When prompted, tap <strong>"Allow"</strong> to download the profile</li>
        <li>Go to <strong>Settings → General → Profile</strong></li>
        <li>Tap on <strong>"Revamp Proxy CA"</strong> profile</li>
        <li>Tap <strong>"Install"</strong> and enter your passcode</li>
      </ol>`;
  }
  return `<ol class="instructions">
        <li>Tap the download button above</li>
        <li>When prompted, tap <strong>"Allow"</strong> to download the profile</li>
        <li>Go to <strong>Settings → General → VPN &amp; Device Management</strong> (older iOS: <strong>Settings → General → Profile</strong>)</li>
        <li>Tap on <strong>"Revamp Proxy CA"</strong> profile</li>
        <li>Tap <strong>"Install"</strong> and enter your passcode</li>
        <li>Go to <strong>Settings → General → About → Certificate Trust Settings</strong></li>
        <li>Enable <strong>"Revamp Proxy CA"</strong> under "Enable Full Trust"</li>
      </ol>`;
}

// HTML template for the captive portal
export function getPortalHTML(localIP: string, portalPort: number, userAgent?: string): string {
  const config = getConfig();
  const trustVariant = detectIosTrustVariant(userAgent);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Revamp Proxy - Certificate Setup</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
      min-height: 100vh;
      color: #fff;
      padding: 20px;
    }
    
    .container {
      max-width: 600px;
      margin: 0 auto;
    }
    
    .header {
      text-align: center;
      padding: 30px 0;
    }
    
    .logo {
      font-size: 48px;
      margin-bottom: 10px;
    }
    
    h1 {
      font-size: 28px;
      font-weight: 600;
      margin-bottom: 8px;
    }
    
    .subtitle {
      color: #94a3b8;
      font-size: 14px;
    }
    
    .card {
      background: rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 20px;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    
    .card h2 {
      font-size: 18px;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    
    .step-number {
      background: #3b82f6;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: 600;
    }
    
    .download-btn {
      display: block;
      width: 100%;
      padding: 16px 24px;
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
      color: white;
      text-decoration: none;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 600;
      text-align: center;
      margin: 16px 0;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    
    .download-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 10px 20px rgba(59, 130, 246, 0.3);
    }
    
    .download-btn:active {
      transform: translateY(0);
    }
    
    .instructions {
      color: #cbd5e1;
      font-size: 14px;
      line-height: 1.8;
    }
    
    .instructions li {
      margin-bottom: 8px;
      padding-left: 8px;
    }
    
    .proxy-info {
      background: rgba(0, 0, 0, 0.2);
      border-radius: 8px;
      padding: 16px;
      margin-top: 12px;
    }
    
    .proxy-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }
    
    .proxy-row:last-child {
      border-bottom: none;
    }
    
    .proxy-label {
      color: #94a3b8;
    }
    
    .proxy-value {
      font-family: 'SF Mono', Monaco, 'Courier New', monospace;
      color: #4ade80;
      font-weight: 500;
    }
    
    .warning {
      background: rgba(251, 191, 36, 0.1);
      border: 1px solid rgba(251, 191, 36, 0.3);
      border-radius: 8px;
      padding: 12px 16px;
      margin-top: 12px;
      font-size: 13px;
      color: #fbbf24;
    }
    
    .success {
      background: rgba(74, 222, 128, 0.1);
      border: 1px solid rgba(74, 222, 128, 0.3);
      border-radius: 8px;
      padding: 12px 16px;
      margin-top: 12px;
      font-size: 13px;
      color: #4ade80;
    }
    
    .footer {
      text-align: center;
      padding: 20px;
      color: #64748b;
      font-size: 12px;
    }

    .tabs {
      display: flex;
      gap: 4px;
      margin-bottom: 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .tab {
      flex: 1;
      padding: 10px 14px;
      background: rgba(255, 255, 255, 0.05);
      color: #cbd5e1;
      text-decoration: none;
      border-radius: 8px 8px 0 0;
      text-align: center;
      font-weight: 500;
      font-size: 14px;
      border: 1px solid transparent;
      border-bottom: none;
    }

    .tab.active {
      background: rgba(59, 130, 246, 0.2);
      color: #fff;
      border-color: rgba(59, 130, 246, 0.5);
    }

    .tab-recommended {
      font-size: 11px;
      color: #4ade80;
      margin-left: 6px;
    }

    .tab-content {
      display: none;
    }

    .tab-content.active {
      display: block;
    }

    .pac-row {
      display: flex;
      align-items: center;
      gap: 8px;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 8px;
      padding: 12px 14px;
      margin-top: 12px;
      word-break: break-all;
    }

    .pac-url {
      flex: 1;
      font-family: 'SF Mono', Monaco, 'Courier New', monospace;
      color: #4ade80;
      font-size: 13px;
    }

    .copy-btn {
      padding: 6px 12px;
      background: #3b82f6;
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 13px;
      cursor: pointer;
      flex-shrink: 0;
    }

    .copy-btn:active {
      background: #2563eb;
    }

    @media (max-width: 480px) {
      body {
        padding: 12px;
      }

      .card {
        padding: 16px;
      }

      h1 {
        font-size: 24px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">🔐</div>
      <h1>Revamp Proxy</h1>
      <p class="subtitle">Legacy Browser Compatibility Proxy for iOS 9+</p>
    </div>
    
    <div class="card">
      <h2><span class="step-number">1</span> Download Certificate</h2>
      <p class="instructions">Install the CA certificate to enable HTTPS support through the proxy.</p>
      <a href="/cert/revamp-ca.crt" class="download-btn">
        📥 Download CA Certificate
      </a>
      <div class="warning">
        ⚠️ After downloading, you need to install and trust the certificate.
      </div>
    </div>
    
    <div class="card">
      <h2><span class="step-number">2</span> Install Certificate (iOS)</h2>
      ${renderIosInstructions(trustVariant)}
    </div>

    <div class="card">
      <h2><span class="step-number">3</span> Configure Proxy</h2>
      <div class="tabs" id="config-tabs">
        <a href="#tab-pac" class="tab active" data-tab="tab-pac">Easy (PAC)<span class="tab-recommended">recommended</span></a>
        <a href="#tab-manual" class="tab" data-tab="tab-manual">Manual (SOCKS5)</a>
      </div>

      <div class="tab-content active" id="tab-pac">
        <p class="instructions">Go to <strong>Settings → Wi-Fi → [Your Network] → Configure Proxy → Automatic</strong> and paste this URL:</p>
        <div class="pac-row">
          <span class="pac-url" id="pac-url">http://${localIP}:${portalPort}/__revamp__/pac/socks5</span>
          <button class="copy-btn" id="pac-copy-btn" type="button">Copy</button>
        </div>
        <div class="success">
          ✅ Automatic mode keeps the proxy off for local addresses and switches it on only for the open web.
        </div>
      </div>

      <div class="tab-content" id="tab-manual">
        <p class="instructions">Go to <strong>Settings → Wi-Fi → [Your Network] → Configure Proxy → Manual</strong></p>
        <div class="proxy-info">
          <div class="proxy-row">
            <span class="proxy-label">Server</span>
            <span class="proxy-value">${localIP}</span>
          </div>
          <div class="proxy-row">
            <span class="proxy-label">Port (SOCKS5)</span>
            <span class="proxy-value">${config.socks5Port}</span>
          </div>
          <div class="proxy-row">
            <span class="proxy-label">Port (HTTP)</span>
            <span class="proxy-value">${config.httpProxyPort}</span>
          </div>
          <div class="proxy-row">
            <span class="proxy-label">Authentication</span>
            <span class="proxy-value">Off</span>
          </div>
        </div>
        <div class="success">
          ✅ After setup, your device will use Revamp to transform modern websites for compatibility!
        </div>
      </div>
    </div>

    <script>
      (function () {
        var tabs = document.getElementById('config-tabs');
        if (!tabs) return;
        var links = tabs.getElementsByClassName('tab');
        function activate(name) {
          for (var i = 0; i < links.length; i++) {
            var link = links[i];
            if (link.getAttribute('data-tab') === name) {
              link.className = 'tab active';
            } else {
              link.className = 'tab';
            }
          }
          var pac = document.getElementById('tab-pac');
          var manual = document.getElementById('tab-manual');
          if (pac) pac.className = name === 'tab-pac' ? 'tab-content active' : 'tab-content';
          if (manual) manual.className = name === 'tab-manual' ? 'tab-content active' : 'tab-content';
        }
        for (var j = 0; j < links.length; j++) {
          (function (link) {
            link.addEventListener('click', function (e) {
              e.preventDefault();
              activate(link.getAttribute('data-tab'));
            });
          })(links[j]);
        }

        var copyBtn = document.getElementById('pac-copy-btn');
        var pacUrl = document.getElementById('pac-url');
        if (copyBtn && pacUrl) {
          copyBtn.addEventListener('click', function () {
            var text = pacUrl.textContent || '';
            try {
              var ta = document.createElement('textarea');
              ta.value = text;
              ta.style.position = 'fixed';
              ta.style.left = '-9999px';
              document.body.appendChild(ta);
              ta.select();
              var ok = document.execCommand('copy');
              document.body.removeChild(ta);
              copyBtn.textContent = ok ? 'Copied!' : 'Copy failed';
            } catch (err) {
              copyBtn.textContent = 'Copy failed';
              console.warn('[portal] copy failed', err);
            }
            setTimeout(function () { copyBtn.textContent = 'Copy'; }, 2000);
          });
        }
      })();
    </script>
    
    <div class="footer">
      <p>Revamp Proxy v1.0 • Transforms modern web for iOS 9+ devices</p>
      <p style="margin-top: 8px;">Portal: http://${localIP}:${portalPort}</p>
    </div>
  </div>
</body>
</html>`;
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
    console.error('[portal] admin route error:', err);
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
      console.log(`📜 Certificate downloaded from ${req.socket.remoteAddress}`);
      return;
    } catch (err) {
      console.error('[portal] cert serve error:', err);
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
    console.error(`❌ Captive portal error: ${err.message}`);
  });

  server.listen(port, bindAddress, () => {
    console.log(`🌐 Captive Portal listening on ${bindAddress}:${port}`);
    console.log(`   Open http://${primaryIP}:${port} on your device to install certificate`);
  });

  return server;
}
