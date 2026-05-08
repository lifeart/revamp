/**
 * Metrics Collection Module
 * Tracks proxy statistics for monitoring and debugging
 */

export interface TransformMetrics {
  js: number;
  css: number;
  html: number;
  images: number;
}

export interface RequestMetrics {
  total: number;
  blocked: number;
  cached: number;
  transformed: number;
}

export interface BandwidthMetrics {
  totalBytesIn: number;
  totalBytesOut: number;
  savedBytes: number;
}

/**
 * T25: per-host counters surfaced in the admin domain panel so users can
 * answer "why is this site blank on my iPad?" without reading server logs.
 */
export interface HostMetrics {
  host: string;
  blocked: number;
  transformedJs: number;
  transformedCss: number;
  transformedHtml: number;
  transformedImages: number;
  errors: number;
  /** Cap-20 ring buffer of most recent URLs (newest first). */
  lastUrls: string[];
}

export interface ProxyMetrics {
  startTime: number;
  uptime: number;
  requests: RequestMetrics;
  transforms: TransformMetrics;
  bandwidth: BandwidthMetrics;
  cacheHitRate: number;
  transformRate: number;
  errors: number;
  activeConnections: number;
  peakConnections: number;
  /** T25: per-host breakdown. Keyed by hostname. */
  hosts: HostMetrics[];
}

// Metrics storage
const metrics = {
  startTime: Date.now(),
  requests: {
    total: 0,
    blocked: 0,
    cached: 0,
    transformed: 0
  },
  transforms: {
    js: 0,
    css: 0,
    html: 0,
    images: 0
  },
  bandwidth: {
    totalBytesIn: 0,
    totalBytesOut: 0,
    savedBytes: 0
  },
  errors: 0,
  activeConnections: 0,
  peakConnections: 0
};

/** Maximum number of URLs to retain per host (newest first). */
const HOST_LAST_URLS_CAP = 20;

/**
 * Maximum number of distinct hosts to retain. Prevents unbounded growth on
 * CDN-heavy sites with thousands of subdomains, or under attack from a
 * client hitting `<random>.example.com`. Each entry is ~520B + up to 20
 * URL strings, so 500 caps the per-host map at a few MB worst case.
 */
const HOST_METRICS_CAP = 500;

/** T25: per-host counters. Keyed by hostname (lowercase, no port). */
const hostMetrics = new Map<string, HostMetrics>();

/**
 * Extract a normalised hostname from a URL string. Returns null when the
 * input is not a parseable absolute URL — in that case the caller skips the
 * per-host record (the global counters still increment).
 */
function extractHost(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Get-or-create the per-host record. Hidden from callers; they go through
 * `recordHost*` helpers below so the call sites stay obvious.
 *
 * LRU semantics: existing entries are deleted and re-set so the host moves
 * to the tail (Map iteration order is insertion order). When the map
 * exceeds `HOST_METRICS_CAP`, the oldest (head) entry is evicted. This
 * keeps the working set bounded under attack or CDN sprawl without
 * starving legitimate hosts.
 */
function getHostEntry(host: string): HostMetrics {
  const existing = hostMetrics.get(host);
  if (existing) {
    // Touch: move to most-recent position by re-inserting.
    hostMetrics.delete(host);
    hostMetrics.set(host, existing);
    return existing;
  }
  const entry: HostMetrics = {
    host,
    blocked: 0,
    transformedJs: 0,
    transformedCss: 0,
    transformedHtml: 0,
    transformedImages: 0,
    errors: 0,
    lastUrls: [],
  };
  hostMetrics.set(host, entry);
  if (hostMetrics.size > HOST_METRICS_CAP) {
    // Evict oldest (first-iterated key in insertion order).
    const oldest = hostMetrics.keys().next().value;
    if (oldest !== undefined) hostMetrics.delete(oldest);
  }
  return entry;
}

function pushHostUrl(entry: HostMetrics, url: string): void {
  // De-dupe consecutive identical URLs (avoids filling the ring with the
  // same favicon hit on a refresh).
  if (entry.lastUrls[0] === url) return;
  entry.lastUrls.unshift(url);
  if (entry.lastUrls.length > HOST_LAST_URLS_CAP) {
    entry.lastUrls.length = HOST_LAST_URLS_CAP;
  }
}

/**
 * T25: record a blocked event with its source URL.
 */
export function recordHostBlocked(url: string | undefined): void {
  const host = extractHost(url);
  if (!host) return;
  const entry = getHostEntry(host);
  entry.blocked++;
  if (url) pushHostUrl(entry, url);
}

/**
 * T25: record a transform event for a specific host.
 */
export function recordHostTransform(
  url: string | undefined,
  type: 'js' | 'css' | 'html' | 'images'
): void {
  const host = extractHost(url);
  if (!host) return;
  const entry = getHostEntry(host);
  if (type === 'js') entry.transformedJs++;
  else if (type === 'css') entry.transformedCss++;
  else if (type === 'html') entry.transformedHtml++;
  else entry.transformedImages++;
  if (url) pushHostUrl(entry, url);
}

/**
 * T25: record an error for a specific host.
 */
export function recordHostError(url: string | undefined): void {
  const host = extractHost(url);
  if (!host) return;
  const entry = getHostEntry(host);
  entry.errors++;
  if (url) pushHostUrl(entry, url);
}

/**
 * Record a new request
 */
export function recordRequest(): void {
  metrics.requests.total++;
}

/**
 * Record a blocked request (ad/tracking)
 */
export function recordBlocked(): void {
  metrics.requests.blocked++;
}

/**
 * Record a cache hit
 */
export function recordCacheHit(): void {
  metrics.requests.cached++;
}

/**
 * Record a transformation
 */
export function recordTransform(type: 'js' | 'css' | 'html' | 'images'): void {
  metrics.transforms[type]++;
  metrics.requests.transformed++;
}

/**
 * Record bandwidth usage
 */
export function recordBandwidth(bytesIn: number, bytesOut: number): void {
  metrics.bandwidth.totalBytesIn += bytesIn;
  metrics.bandwidth.totalBytesOut += bytesOut;

  // Calculate saved bytes (negative means we added data, e.g., polyfills)
  metrics.bandwidth.savedBytes += (bytesIn - bytesOut);
}

/**
 * Record an error
 */
export function recordError(): void {
  metrics.errors++;
}

/**
 * Update active connection count
 */
export function updateConnections(delta: number): void {
  metrics.activeConnections += delta;
  if (metrics.activeConnections > metrics.peakConnections) {
    metrics.peakConnections = metrics.activeConnections;
  }
  if (metrics.activeConnections < 0) {
    metrics.activeConnections = 0;
  }
}

/**
 * Get current metrics
 */
export function getMetrics(): ProxyMetrics {
  const uptime = Date.now() - metrics.startTime;
  const cacheHitRate = metrics.requests.total > 0
    ? (metrics.requests.cached / metrics.requests.total) * 100
    : 0;
  const transformRate = metrics.requests.total > 0
    ? (metrics.requests.transformed / metrics.requests.total) * 100
    : 0;

  const hosts: HostMetrics[] = [];
  for (const entry of hostMetrics.values()) {
    hosts.push({
      ...entry,
      lastUrls: entry.lastUrls.slice(),
    });
  }

  return {
    startTime: metrics.startTime,
    uptime,
    requests: { ...metrics.requests },
    transforms: { ...metrics.transforms },
    bandwidth: { ...metrics.bandwidth },
    cacheHitRate,
    transformRate,
    errors: metrics.errors,
    activeConnections: metrics.activeConnections,
    peakConnections: metrics.peakConnections,
    hosts,
  };
}

/**
 * Get the per-host metrics for one specific host. Returns null when the
 * host has not been recorded yet. Exported for the admin domain panel
 * (T25) which renders one entry per profile.
 */
export function getHostMetrics(host: string): HostMetrics | null {
  const entry = hostMetrics.get(host.toLowerCase());
  if (!entry) return null;
  return { ...entry, lastUrls: entry.lastUrls.slice() };
}

/**
 * Reset metrics (useful for testing)
 */
export function resetMetrics(): void {
  metrics.startTime = Date.now();
  metrics.requests.total = 0;
  metrics.requests.blocked = 0;
  metrics.requests.cached = 0;
  metrics.requests.transformed = 0;
  metrics.transforms.js = 0;
  metrics.transforms.css = 0;
  metrics.transforms.html = 0;
  metrics.transforms.images = 0;
  metrics.bandwidth.totalBytesIn = 0;
  metrics.bandwidth.totalBytesOut = 0;
  metrics.bandwidth.savedBytes = 0;
  metrics.errors = 0;
  metrics.activeConnections = 0;
  metrics.peakConnections = 0;
  hostMetrics.clear();
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
}

/**
 * Format duration to human-readable string
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
