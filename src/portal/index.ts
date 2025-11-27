/**
 * Captive Portal Server
 * Serves a webpage for downloading and installing the CA certificate
 * Useful for iOS devices that need to trust the proxy certificate
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { getCACert } from '../certs/index.js';
import { getConfig } from '../config/index.js';
import { networkInterfaces } from 'node:os';

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

// HTML template for the captive portal
function getPortalHTML(localIP: string, portalPort: number): string {
  const config = getConfig();
  
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
      <ol class="instructions">
        <li>Tap the download button above</li>
        <li>When prompted, tap <strong>"Allow"</strong> to download the profile</li>
        <li>Go to <strong>Settings → General → VPN & Device Management</strong></li>
        <li>Tap on <strong>"Revamp Proxy CA"</strong> profile</li>
        <li>Tap <strong>"Install"</strong> and enter your passcode</li>
        <li>Go to <strong>Settings → General → About → Certificate Trust Settings</strong></li>
        <li>Enable <strong>"Revamp Proxy CA"</strong> under "Enable Full Trust"</li>
      </ol>
    </div>
    
    <div class="card">
      <h2><span class="step-number">3</span> Configure Proxy</h2>
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
    
    <div class="footer">
      <p>Revamp Proxy v1.0 • Transforms modern web for iOS 9+ devices</p>
      <p style="margin-top: 8px;">Portal: http://${localIP}:${portalPort}</p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Create and start the captive portal server
 */
export function createCaptivePortal(port: number, bindAddress: string = '0.0.0.0'): Server {
  const localIPs = getLocalIPs();
  const primaryIP = localIPs[0] || '127.0.0.1';
  
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url || '/';
    
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
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Error generating certificate');
        return;
      }
    }
    
    // Serve the portal page for iOS captive portal detection
    // iOS checks these URLs to detect captive portals
    if (url === '/hotspot-detect.html' || 
        url === '/library/test/success.html' ||
        url === '/success.txt' ||
        url === '/generate_204' ||
        url === '/gen_204') {
      // Return the portal page instead of success to trigger captive portal UI
      res.writeHead(200, { 
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      });
      res.end(getPortalHTML(primaryIP, port));
      return;
    }
    
    // Default: serve the portal page
    res.writeHead(200, { 
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    });
    res.end(getPortalHTML(primaryIP, port));
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
