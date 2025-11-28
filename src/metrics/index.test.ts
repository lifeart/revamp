import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordRequest,
  recordBlocked,
  recordCacheHit,
  recordTransform,
  recordBandwidth,
  recordError,
  updateConnections,
  getMetrics,
  resetMetrics,
  formatBytes,
  formatDuration,
} from './index.js';

describe('recordRequest', () => {
  beforeEach(() => {
    resetMetrics();
  });

  it('should increment total requests', () => {
    const initialMetrics = getMetrics();
    const initialTotal = initialMetrics.requests.total;

    recordRequest();

    const metrics = getMetrics();
    expect(metrics.requests.total).toBe(initialTotal + 1);
  });

  it('should increment multiple times', () => {
    recordRequest();
    recordRequest();
    recordRequest();

    const metrics = getMetrics();
    expect(metrics.requests.total).toBe(3);
  });
});

describe('recordBlocked', () => {
  beforeEach(() => {
    resetMetrics();
  });

  it('should increment blocked requests', () => {
    recordBlocked();

    const metrics = getMetrics();
    expect(metrics.requests.blocked).toBe(1);
  });

  it('should increment multiple times', () => {
    recordBlocked();
    recordBlocked();

    const metrics = getMetrics();
    expect(metrics.requests.blocked).toBe(2);
  });
});

describe('recordCacheHit', () => {
  beforeEach(() => {
    resetMetrics();
  });

  it('should increment cached requests', () => {
    recordCacheHit();

    const metrics = getMetrics();
    expect(metrics.requests.cached).toBe(1);
  });

  it('should affect cache hit rate', () => {
    recordRequest();
    recordCacheHit();

    const metrics = getMetrics();
    expect(metrics.cacheHitRate).toBe(100);
  });
});

describe('recordTransform', () => {
  beforeEach(() => {
    resetMetrics();
  });

  it('should increment JS transforms', () => {
    recordTransform('js');

    const metrics = getMetrics();
    expect(metrics.transforms.js).toBe(1);
    expect(metrics.requests.transformed).toBe(1);
  });

  it('should increment CSS transforms', () => {
    recordTransform('css');

    const metrics = getMetrics();
    expect(metrics.transforms.css).toBe(1);
    expect(metrics.requests.transformed).toBe(1);
  });

  it('should increment HTML transforms', () => {
    recordTransform('html');

    const metrics = getMetrics();
    expect(metrics.transforms.html).toBe(1);
    expect(metrics.requests.transformed).toBe(1);
  });

  it('should increment image transforms', () => {
    recordTransform('images');

    const metrics = getMetrics();
    expect(metrics.transforms.images).toBe(1);
    expect(metrics.requests.transformed).toBe(1);
  });

  it('should track total transformed separately from type', () => {
    recordTransform('js');
    recordTransform('css');
    recordTransform('html');

    const metrics = getMetrics();
    expect(metrics.transforms.js).toBe(1);
    expect(metrics.transforms.css).toBe(1);
    expect(metrics.transforms.html).toBe(1);
    expect(metrics.requests.transformed).toBe(3);
  });
});

describe('recordBandwidth', () => {
  beforeEach(() => {
    resetMetrics();
  });

  it('should record bytes in', () => {
    recordBandwidth(1000, 800);

    const metrics = getMetrics();
    expect(metrics.bandwidth.totalBytesIn).toBe(1000);
  });

  it('should record bytes out', () => {
    recordBandwidth(1000, 800);

    const metrics = getMetrics();
    expect(metrics.bandwidth.totalBytesOut).toBe(800);
  });

  it('should calculate saved bytes', () => {
    recordBandwidth(1000, 800);

    const metrics = getMetrics();
    // Saved = bytesIn - bytesOut = 1000 - 800 = 200
    expect(metrics.bandwidth.savedBytes).toBe(200);
  });

  it('should track negative saved bytes (when we add data)', () => {
    recordBandwidth(1000, 1200);

    const metrics = getMetrics();
    // Saved = 1000 - 1200 = -200
    expect(metrics.bandwidth.savedBytes).toBe(-200);
  });

  it('should accumulate across multiple calls', () => {
    recordBandwidth(1000, 800);
    recordBandwidth(500, 400);

    const metrics = getMetrics();
    expect(metrics.bandwidth.totalBytesIn).toBe(1500);
    expect(metrics.bandwidth.totalBytesOut).toBe(1200);
    expect(metrics.bandwidth.savedBytes).toBe(300);
  });
});

describe('recordError', () => {
  beforeEach(() => {
    resetMetrics();
  });

  it('should increment error count', () => {
    recordError();

    const metrics = getMetrics();
    expect(metrics.errors).toBe(1);
  });

  it('should increment multiple times', () => {
    recordError();
    recordError();
    recordError();

    const metrics = getMetrics();
    expect(metrics.errors).toBe(3);
  });
});

describe('updateConnections', () => {
  beforeEach(() => {
    resetMetrics();
  });

  it('should increment active connections', () => {
    updateConnections(1);

    const metrics = getMetrics();
    expect(metrics.activeConnections).toBe(1);
  });

  it('should decrement active connections', () => {
    updateConnections(1);
    updateConnections(1);
    updateConnections(-1);

    const metrics = getMetrics();
    expect(metrics.activeConnections).toBe(1);
  });

  it('should track peak connections', () => {
    updateConnections(1);
    updateConnections(1);
    updateConnections(1);
    updateConnections(-2);

    const metrics = getMetrics();
    expect(metrics.activeConnections).toBe(1);
    expect(metrics.peakConnections).toBe(3);
  });

  it('should not go below zero', () => {
    updateConnections(-5);

    const metrics = getMetrics();
    expect(metrics.activeConnections).toBe(0);
  });
});

describe('getMetrics', () => {
  beforeEach(() => {
    resetMetrics();
  });

  it('should return all metrics', () => {
    const metrics = getMetrics();

    expect(metrics).toHaveProperty('startTime');
    expect(metrics).toHaveProperty('uptime');
    expect(metrics).toHaveProperty('requests');
    expect(metrics).toHaveProperty('transforms');
    expect(metrics).toHaveProperty('bandwidth');
    expect(metrics).toHaveProperty('cacheHitRate');
    expect(metrics).toHaveProperty('transformRate');
    expect(metrics).toHaveProperty('errors');
    expect(metrics).toHaveProperty('activeConnections');
    expect(metrics).toHaveProperty('peakConnections');
  });

  it('should calculate uptime', () => {
    const metrics = getMetrics();
    expect(metrics.uptime).toBeGreaterThanOrEqual(0);
  });

  it('should calculate cache hit rate correctly', () => {
    recordRequest();
    recordRequest();
    recordCacheHit();

    const metrics = getMetrics();
    expect(metrics.cacheHitRate).toBe(50);
  });

  it('should calculate transform rate correctly', () => {
    recordRequest();
    recordRequest();
    recordTransform('js');

    const metrics = getMetrics();
    expect(metrics.transformRate).toBe(50);
  });

  it('should return 0 rates when no requests', () => {
    const metrics = getMetrics();
    expect(metrics.cacheHitRate).toBe(0);
    expect(metrics.transformRate).toBe(0);
  });
});

describe('resetMetrics', () => {
  it('should reset all metrics', () => {
    recordRequest();
    recordBlocked();
    recordCacheHit();
    recordTransform('js');
    recordBandwidth(1000, 800);
    recordError();
    updateConnections(5);

    resetMetrics();

    const metrics = getMetrics();
    expect(metrics.requests.total).toBe(0);
    expect(metrics.requests.blocked).toBe(0);
    expect(metrics.requests.cached).toBe(0);
    expect(metrics.requests.transformed).toBe(0);
    expect(metrics.transforms.js).toBe(0);
    expect(metrics.transforms.css).toBe(0);
    expect(metrics.transforms.html).toBe(0);
    expect(metrics.transforms.images).toBe(0);
    expect(metrics.bandwidth.totalBytesIn).toBe(0);
    expect(metrics.bandwidth.totalBytesOut).toBe(0);
    expect(metrics.bandwidth.savedBytes).toBe(0);
    expect(metrics.errors).toBe(0);
    expect(metrics.activeConnections).toBe(0);
    expect(metrics.peakConnections).toBe(0);
  });

  it('should reset start time', () => {
    const beforeReset = getMetrics().startTime;

    // Small delay to ensure different timestamp
    resetMetrics();

    const afterReset = getMetrics().startTime;
    expect(afterReset).toBeGreaterThanOrEqual(beforeReset);
  });
});

describe('formatBytes', () => {
  it('should format 0 bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('should format bytes', () => {
    expect(formatBytes(500)).toBe('500.00 B');
    expect(formatBytes(999)).toBe('999.00 B');
  });

  it('should format kilobytes', () => {
    expect(formatBytes(1024)).toBe('1.00 KB');
    expect(formatBytes(1536)).toBe('1.50 KB');
    expect(formatBytes(10240)).toBe('10.00 KB');
  });

  it('should format megabytes', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.00 MB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.00 MB');
  });

  it('should format gigabytes', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.00 GB');
  });

  it('should handle negative bytes', () => {
    expect(formatBytes(-1024)).toBe('-1.00 KB');
  });
});

describe('formatDuration', () => {
  it('should format seconds', () => {
    expect(formatDuration(5000)).toBe('5s');
    expect(formatDuration(59000)).toBe('59s');
  });

  it('should format minutes and seconds', () => {
    expect(formatDuration(60000)).toBe('1m 0s');
    expect(formatDuration(90000)).toBe('1m 30s');
    expect(formatDuration(3599000)).toBe('59m 59s');
  });

  it('should format hours, minutes and seconds', () => {
    expect(formatDuration(3600000)).toBe('1h 0m 0s');
    expect(formatDuration(3661000)).toBe('1h 1m 1s');
    expect(formatDuration(86399000)).toBe('23h 59m 59s');
  });

  it('should format days', () => {
    expect(formatDuration(86400000)).toBe('1d 0h 0m');
    expect(formatDuration(90061000)).toBe('1d 1h 1m');
  });

  it('should handle 0 duration', () => {
    expect(formatDuration(0)).toBe('0s');
  });
});
