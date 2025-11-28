/**
 * Metrics Dashboard Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateDashboardHtml, generateMetricsJson } from './dashboard.js';
import { resetMetrics, recordRequest, recordCacheHit, recordTransform, recordBandwidth } from './index.js';
import { resetConfig, updateConfig } from '../config/index.js';

describe('generateDashboardHtml', () => {
  beforeEach(() => {
    resetMetrics();
    resetConfig();
  });

  afterEach(() => {
    resetMetrics();
    resetConfig();
  });

  it('should return valid HTML', () => {
    const html = generateDashboardHtml();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
    expect(html).toContain('<head>');
    expect(html).toContain('<body>');
  });

  it('should include dashboard title', () => {
    const html = generateDashboardHtml();
    expect(html).toContain('Revamp');
    expect(html).toContain('Metrics');
  });

  it('should include metrics sections', () => {
    const html = generateDashboardHtml();
    expect(html).toContain('Uptime');
    expect(html).toContain('Total Requests');
    expect(html).toContain('Cache Hit Rate');
    expect(html).toContain('Transformations');
    expect(html).toContain('Bandwidth');
  });

  it('should include configuration section', () => {
    const html = generateDashboardHtml();
    expect(html).toContain('Active Configuration');
    expect(html).toContain('Transform JS');
    expect(html).toContain('Transform CSS');
    expect(html).toContain('Transform HTML');
    expect(html).toContain('Remove Ads');
    expect(html).toContain('Remove Tracking');
  });

  it('should include server info', () => {
    const html = generateDashboardHtml();
    expect(html).toContain('SOCKS5 Port');
    expect(html).toContain('HTTP Port');
    expect(html).toContain('Local IP');
  });

  it('should include auto-refresh script', () => {
    const html = generateDashboardHtml();
    expect(html).toContain('<script>');
    expect(html).toContain('setTimeout');
    expect(html).toContain('reload()');
  });

  it('should include navigation links', () => {
    const html = generateDashboardHtml();
    expect(html).toContain('/__revamp__/metrics/json');
    expect(html).toContain('/__revamp__/pac/socks5');
  });

  it('should reflect request metrics', () => {
    recordRequest();
    recordRequest();
    recordRequest();
    const html = generateDashboardHtml();
    // The HTML should contain the number 3 for total requests
    expect(html).toContain('Total Requests');
  });

  it('should reflect transformation metrics', () => {
    recordTransform('js');
    recordTransform('css');
    recordTransform('html');
    const html = generateDashboardHtml();
    expect(html).toContain('JavaScript');
    expect(html).toContain('CSS');
    expect(html).toContain('HTML');
  });

  it('should reflect bandwidth metrics', () => {
    recordBandwidth(1000, 800);
    const html = generateDashboardHtml();
    expect(html).toContain('Downloaded');
    expect(html).toContain('Sent to Client');
    expect(html).toContain('Saved');
  });

  it('should reflect config changes', () => {
    updateConfig({ transformJs: false });
    const html = generateDashboardHtml();
    expect(html).toContain('Transform JS');
    expect(html).toContain('OFF');
  });

  it('should include CSS styling', () => {
    const html = generateDashboardHtml();
    expect(html).toContain('<style>');
    expect(html).toContain('</style>');
    expect(html).toContain('font-family');
    expect(html).toContain('background');
  });
});

describe('generateMetricsJson', () => {
  beforeEach(() => {
    resetMetrics();
  });

  afterEach(() => {
    resetMetrics();
  });

  it('should return valid JSON', () => {
    const json = generateMetricsJson();
    const parsed = JSON.parse(json);
    expect(parsed).toBeDefined();
    expect(typeof parsed).toBe('object');
  });

  it('should include uptime', () => {
    const json = generateMetricsJson();
    const parsed = JSON.parse(json);
    expect(parsed.uptime).toBeDefined();
    expect(typeof parsed.uptime).toBe('number');
  });

  it('should include request counts', () => {
    const json = generateMetricsJson();
    const parsed = JSON.parse(json);
    expect(parsed.requests).toBeDefined();
    expect(parsed.requests.total).toBeDefined();
    expect(parsed.requests.cached).toBeDefined();
    expect(parsed.requests.blocked).toBeDefined();
  });

  it('should include transforms', () => {
    const json = generateMetricsJson();
    const parsed = JSON.parse(json);
    expect(parsed.transforms).toBeDefined();
    expect(parsed.transforms.js).toBeDefined();
    expect(parsed.transforms.css).toBeDefined();
    expect(parsed.transforms.html).toBeDefined();
  });

  it('should include bandwidth', () => {
    const json = generateMetricsJson();
    const parsed = JSON.parse(json);
    expect(parsed.bandwidth).toBeDefined();
    expect(parsed.bandwidth.totalBytesIn).toBeDefined();
    expect(parsed.bandwidth.totalBytesOut).toBeDefined();
    expect(parsed.bandwidth.savedBytes).toBeDefined();
  });

  it('should reflect recorded metrics', () => {
    recordRequest();
    recordCacheHit();
    recordTransform('js');
    recordBandwidth(1000, 800);

    const json = generateMetricsJson();
    const parsed = JSON.parse(json);

    expect(parsed.requests.total).toBe(1);
    expect(parsed.requests.cached).toBe(1);
    expect(parsed.transforms.js).toBe(1);
    expect(parsed.bandwidth.totalBytesIn).toBe(1000);
    expect(parsed.bandwidth.totalBytesOut).toBe(800);
  });

  it('should be pretty printed', () => {
    const json = generateMetricsJson();
    // Pretty printed JSON has newlines
    expect(json).toContain('\n');
  });
});
