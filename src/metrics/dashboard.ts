/**
 * Metrics Dashboard
 * HTML dashboard for viewing proxy statistics
 */

import { getMetrics, formatBytes, formatDuration } from './index.js';
import { getConfig, CLIENT_CONFIG_OPTIONS } from '../config/index.js';
import { getLocalIpAddress } from '../pac/generator.js';
import type { RevampConfig } from '../config/index.js';
import { loadTemplate, renderTemplate } from '../util/template.js';

/**
 * Generate config items HTML from client options metadata
 */
function generateConfigItemsHtml(config: RevampConfig): string {
  const itemTemplate = loadTemplate(new URL('./templates/config-item.html', import.meta.url));
  return CLIENT_CONFIG_OPTIONS.map((opt) => {
    const value = config[opt.key as keyof RevampConfig] as boolean;
    return renderTemplate(itemTemplate, {
      cssClass: value ? 'config-on' : 'config-off',
      label: opt.label,
      status: value ? 'ON' : 'OFF',
    });
  }).join('\n        ');
}

/**
 * Generate the metrics dashboard HTML
 */
export function generateDashboardHtml(): string {
  const metrics = getMetrics();
  const config = getConfig();
  const localIp = getLocalIpAddress();

  return renderTemplate(loadTemplate(new URL('./templates/dashboard.html', import.meta.url)), {
    uptime: formatDuration(metrics.uptime),
    startTime: new Date(metrics.startTime).toLocaleString(),
    totalRequests: metrics.requests.total.toLocaleString(),
    activeConnections: metrics.activeConnections,
    cacheRateClass: metrics.cacheHitRate > 50 ? 'success' : 'warning',
    cacheHitRate: metrics.cacheHitRate.toFixed(1),
    cacheHitRateWidth: metrics.cacheHitRate,
    cachedRequests: metrics.requests.cached.toLocaleString(),
    blockedClass: metrics.requests.blocked > 0 ? 'success' : '',
    blockedRequests: metrics.requests.blocked.toLocaleString(),
    txJs: metrics.transforms.js.toLocaleString(),
    txCss: metrics.transforms.css.toLocaleString(),
    txHtml: metrics.transforms.html.toLocaleString(),
    txImages: metrics.transforms.images.toLocaleString(),
    bwIn: formatBytes(metrics.bandwidth.totalBytesIn),
    bwOut: formatBytes(metrics.bandwidth.totalBytesOut),
    bwSavedClass: metrics.bandwidth.savedBytes > 0 ? 'success' : 'warning',
    bwSaved: formatBytes(metrics.bandwidth.savedBytes),
    socks5Port: config.socks5Port,
    httpProxyPort: config.httpProxyPort,
    localIp,
    peakConnections: metrics.peakConnections,
    errorsClass: metrics.errors > 0 ? 'error' : '',
    errors: metrics.errors,
    configItems: generateConfigItemsHtml(config),
  });
}

/**
 * Generate JSON metrics response
 */
export function generateMetricsJson(): string {
  return JSON.stringify(getMetrics(), null, 2);
}
