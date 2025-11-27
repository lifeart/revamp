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
    peakConnections: metrics.peakConnections
  };
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
