/**
 * Metrics Dashboard
 * HTML dashboard for viewing proxy statistics
 */

import { getMetrics, formatBytes, formatDuration } from './index.js';
import { getConfig, CLIENT_CONFIG_OPTIONS } from '../config/index.js';
import { getLocalIpAddress } from '../pac/generator.js';
import type { RevampConfig } from '../config/index.js';

/**
 * Generate config items HTML from client options metadata
 */
function generateConfigItemsHtml(config: RevampConfig): string {
  return CLIENT_CONFIG_OPTIONS.map((opt) => {
    const value = config[opt.key as keyof RevampConfig] as boolean;
    const cssClass = value ? 'config-on' : 'config-off';
    const status = value ? 'ON' : 'OFF';
    return `<span class="config-item ${cssClass}">${opt.label}: ${status}</span>`;
  }).join('\n        ');
}

/**
 * Generate the metrics dashboard HTML
 */
export function generateDashboardHtml(): string {
  const metrics = getMetrics();
  const config = getConfig();
  const localIp = getLocalIpAddress();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Revamp - Metrics Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #fff;
      min-height: 100vh;
      padding: 20px;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 {
      font-size: 2.5rem;
      margin-bottom: 10px;
      background: linear-gradient(90deg, #00d4ff, #7b2cbf);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .subtitle { color: #888; margin-bottom: 30px; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .card {
      background: rgba(255, 255, 255, 0.05);
      border-radius: 16px;
      padding: 24px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(10px);
    }
    .card-title {
      font-size: 0.9rem;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 12px;
    }
    .card-value {
      font-size: 2.5rem;
      font-weight: 700;
      margin-bottom: 8px;
    }
    .card-subtitle { color: #666; font-size: 0.9rem; }
    .highlight { color: #00d4ff; }
    .success { color: #00ff88; }
    .warning { color: #ffaa00; }
    .error { color: #ff4444; }
    .stat-row {
      display: flex;
      justify-content: space-between;
      padding: 12px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    .stat-row:last-child { border-bottom: none; }
    .stat-label { color: #888; }
    .stat-value { font-weight: 600; }
    .progress-bar {
      background: rgba(255, 255, 255, 0.1);
      border-radius: 10px;
      height: 20px;
      overflow: hidden;
      margin: 12px 0;
    }
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #00d4ff, #7b2cbf);
      border-radius: 10px;
      transition: width 0.5s ease;
    }
    .config-section {
      background: rgba(255, 255, 255, 0.03);
      border-radius: 12px;
      padding: 20px;
      margin-top: 20px;
    }
    .config-item {
      display: inline-block;
      background: rgba(255, 255, 255, 0.1);
      padding: 6px 12px;
      border-radius: 20px;
      margin: 4px;
      font-size: 0.85rem;
    }
    .config-on { background: rgba(0, 255, 136, 0.2); color: #00ff88; }
    .config-off { background: rgba(255, 68, 68, 0.2); color: #ff4444; }
    .refresh-info {
      text-align: center;
      color: #666;
      margin-top: 30px;
      font-size: 0.9rem;
    }
    @media (max-width: 600px) {
      .card-value { font-size: 1.8rem; }
      h1 { font-size: 1.8rem; }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📊 Revamp Metrics</h1>
    <p class="subtitle">Legacy Browser Compatibility Proxy</p>

    <div class="grid">
      <div class="card">
        <div class="card-title">⏱️ Uptime</div>
        <div class="card-value highlight">${formatDuration(metrics.uptime)}</div>
        <div class="card-subtitle">Since ${new Date(metrics.startTime).toLocaleString()}</div>
      </div>

      <div class="card">
        <div class="card-title">📡 Total Requests</div>
        <div class="card-value">${metrics.requests.total.toLocaleString()}</div>
        <div class="card-subtitle">${metrics.activeConnections} active connections</div>
      </div>

      <div class="card">
        <div class="card-title">💾 Cache Hit Rate</div>
        <div class="card-value ${metrics.cacheHitRate > 50 ? 'success' : 'warning'}">${metrics.cacheHitRate.toFixed(1)}%</div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${metrics.cacheHitRate}%"></div>
        </div>
        <div class="card-subtitle">${metrics.requests.cached.toLocaleString()} cached requests</div>
      </div>

      <div class="card">
        <div class="card-title">🚫 Blocked Requests</div>
        <div class="card-value ${metrics.requests.blocked > 0 ? 'success' : ''}">${metrics.requests.blocked.toLocaleString()}</div>
        <div class="card-subtitle">Ads & trackers blocked</div>
      </div>
    </div>

    <div class="grid">
      <div class="card">
        <div class="card-title">🔄 Transformations</div>
        <div class="stat-row">
          <span class="stat-label">JavaScript</span>
          <span class="stat-value">${metrics.transforms.js.toLocaleString()}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">CSS</span>
          <span class="stat-value">${metrics.transforms.css.toLocaleString()}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">HTML</span>
          <span class="stat-value">${metrics.transforms.html.toLocaleString()}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Images</span>
          <span class="stat-value">${metrics.transforms.images.toLocaleString()}</span>
        </div>
      </div>

      <div class="card">
        <div class="card-title">📊 Bandwidth</div>
        <div class="stat-row">
          <span class="stat-label">Downloaded</span>
          <span class="stat-value">${formatBytes(metrics.bandwidth.totalBytesIn)}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Sent to Client</span>
          <span class="stat-value">${formatBytes(metrics.bandwidth.totalBytesOut)}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Saved</span>
          <span class="stat-value ${metrics.bandwidth.savedBytes > 0 ? 'success' : 'warning'}">${formatBytes(metrics.bandwidth.savedBytes)}</span>
        </div>
      </div>

      <div class="card">
        <div class="card-title">🔧 Server Info</div>
        <div class="stat-row">
          <span class="stat-label">SOCKS5 Port</span>
          <span class="stat-value">${config.socks5Port}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">HTTP Port</span>
          <span class="stat-value">${config.httpProxyPort}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Local IP</span>
          <span class="stat-value">${localIp}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Peak Connections</span>
          <span class="stat-value">${metrics.peakConnections}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Errors</span>
          <span class="stat-value ${metrics.errors > 0 ? 'error' : ''}">${metrics.errors}</span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">⚙️ Active Configuration</div>
      <div class="config-section">
        ${generateConfigItemsHtml(config)}
      </div>
    </div>

    <p class="refresh-info">
      Auto-refreshes every 5 seconds •
      <a href="/__revamp__/metrics/json" style="color: #00d4ff;">JSON API</a> •
      <a href="/__revamp__/pac/socks5" style="color: #00d4ff;">PAC File</a>
    </p>
  </div>

  <script>
    // Auto-refresh every 5 seconds
    setTimeout(function() {
      location.reload();
    }, 5000);
  </script>
</body>
</html>`;
}

/**
 * Generate JSON metrics response
 */
export function generateMetricsJson(): string {
  return JSON.stringify(getMetrics(), null, 2);
}
