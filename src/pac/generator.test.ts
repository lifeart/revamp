import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  generateSocks5Pac,
  generateHttpPac,
  generateCombinedPac,
  generateSelectivePac,
  getAllPacFiles,
  getLocalIpAddress,
} from './generator.js';
import { resetConfig, updateConfig } from '../config/index.js';

describe('getLocalIpAddress', () => {
  it('should return a valid IP address', () => {
    const ip = getLocalIpAddress();
    // Should be either localhost or a LAN address
    expect(ip).toMatch(/^(\d{1,3}\.){3}\d{1,3}$/);
  });

  it('should return a LAN address or localhost', () => {
    const ip = getLocalIpAddress();
    const isLAN = ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.');
    const isLocalhost = ip === '127.0.0.1';
    expect(isLAN || isLocalhost).toBe(true);
  });
});

describe('generateSocks5Pac', () => {
  beforeEach(() => {
    resetConfig();
    updateConfig({ socks5Port: 1080 });
  });

  afterEach(() => {
    resetConfig();
  });

  it('should generate valid PAC file content', () => {
    const pac = generateSocks5Pac('192.168.1.100', 1080);

    expect(pac).toContain('FindProxyForURL');
    expect(pac).toContain('function');
    expect(pac).toContain('SOCKS5 192.168.1.100:1080');
  });

  it('should include SOCKS fallback', () => {
    const pac = generateSocks5Pac('192.168.1.100', 1080);

    expect(pac).toContain('SOCKS5');
    expect(pac).toContain('SOCKS ');
    expect(pac).toContain('DIRECT');
  });

  it('should bypass localhost', () => {
    const pac = generateSocks5Pac('192.168.1.100', 1080);

    expect(pac).toContain('isPlainHostName');
    expect(pac).toContain('localhost');
    expect(pac).toContain('127.0.0.1');
  });

  it('should bypass .local domains', () => {
    const pac = generateSocks5Pac();
    expect(pac).toContain('*.local');
  });

  it('should use default port from config', () => {
    updateConfig({ socks5Port: 9999 });
    const pac = generateSocks5Pac('192.168.1.100');

    expect(pac).toContain(':9999');
  });

  it('should use detected IP when not provided', () => {
    const pac = generateSocks5Pac();
    const ip = getLocalIpAddress();

    expect(pac).toContain(ip);
  });

  it('should include comment header', () => {
    const pac = generateSocks5Pac();

    expect(pac).toContain('// Revamp');
    expect(pac).toContain('SOCKS5');
    expect(pac).toContain('Generated:');
  });
});

describe('generateHttpPac', () => {
  beforeEach(() => {
    resetConfig();
    updateConfig({ httpProxyPort: 8080 });
  });

  afterEach(() => {
    resetConfig();
  });

  it('should generate valid PAC file content', () => {
    const pac = generateHttpPac('192.168.1.100', 8080);

    expect(pac).toContain('FindProxyForURL');
    expect(pac).toContain('function');
    expect(pac).toContain('PROXY 192.168.1.100:8080');
  });

  it('should include DIRECT fallback', () => {
    const pac = generateHttpPac('192.168.1.100', 8080);

    expect(pac).toContain('PROXY');
    expect(pac).toContain('DIRECT');
  });

  it('should bypass localhost', () => {
    const pac = generateHttpPac('192.168.1.100', 8080);

    expect(pac).toContain('isPlainHostName');
    expect(pac).toContain('localhost');
    expect(pac).toContain('127.0.0.1');
  });

  it('should use default port from config', () => {
    updateConfig({ httpProxyPort: 3128 });
    const pac = generateHttpPac('192.168.1.100');

    expect(pac).toContain(':3128');
  });

  it('should include comment header', () => {
    const pac = generateHttpPac();

    expect(pac).toContain('// Revamp');
    expect(pac).toContain('HTTP');
    expect(pac).toContain('Generated:');
  });
});

describe('generateCombinedPac', () => {
  beforeEach(() => {
    resetConfig();
    updateConfig({ socks5Port: 1080, httpProxyPort: 8080 });
  });

  afterEach(() => {
    resetConfig();
  });

  it('should generate valid PAC file content', () => {
    const pac = generateCombinedPac('192.168.1.100');

    expect(pac).toContain('FindProxyForURL');
    expect(pac).toContain('function');
  });

  it('should use SOCKS5 for HTTPS', () => {
    const pac = generateCombinedPac('192.168.1.100');

    expect(pac).toContain('https:');
    expect(pac).toContain('SOCKS5');
  });

  it('should use HTTP PROXY for HTTP', () => {
    const pac = generateCombinedPac('192.168.1.100');

    expect(pac).toContain('PROXY');
  });

  it('should bypass localhost', () => {
    const pac = generateCombinedPac('192.168.1.100');

    expect(pac).toContain('localhost');
    expect(pac).toContain('127.0.0.1');
  });

  it('should include both ports from config', () => {
    updateConfig({ socks5Port: 9080, httpProxyPort: 3128 });
    const pac = generateCombinedPac('192.168.1.100');

    expect(pac).toContain(':9080');
    expect(pac).toContain(':3128');
  });

  it('should include comment header', () => {
    const pac = generateCombinedPac();

    expect(pac).toContain('// Revamp');
    expect(pac).toContain('Combined');
  });
});

describe('generateSelectivePac', () => {
  beforeEach(() => {
    resetConfig();
    updateConfig({ socks5Port: 1080 });
  });

  afterEach(() => {
    resetConfig();
  });

  it('should generate valid PAC file content', () => {
    const domains = ['example.com', 'test.org'];
    const pac = generateSelectivePac(domains, '192.168.1.100', 1080);

    expect(pac).toContain('FindProxyForURL');
    expect(pac).toContain('function');
  });

  it('should only proxy specified domains', () => {
    const domains = ['example.com', 'test.org'];
    const pac = generateSelectivePac(domains, '192.168.1.100', 1080);

    expect(pac).toContain('*example.com');
    expect(pac).toContain('*test.org');
  });

  it('should return DIRECT for non-proxied domains', () => {
    const domains = ['example.com'];
    const pac = generateSelectivePac(domains, '192.168.1.100', 1080);

    // Should have DIRECT as fallback
    expect(pac).toMatch(/return\s+"DIRECT"/);
  });

  it('should bypass localhost', () => {
    const domains = ['example.com'];
    const pac = generateSelectivePac(domains);

    expect(pac).toContain('localhost');
    expect(pac).toContain('127.0.0.1');
  });

  it('should handle empty domain list', () => {
    const pac = generateSelectivePac([], '192.168.1.100', 1080);

    // Should still be valid PAC
    expect(pac).toContain('FindProxyForURL');
    expect(pac).toContain('function');
  });

  it('should include comment with domain count', () => {
    const domains = ['example.com', 'test.org', 'foo.bar'];
    const pac = generateSelectivePac(domains);

    expect(pac).toContain('Proxied domains: 3');
  });

  it('should use default port from config', () => {
    updateConfig({ socks5Port: 9999 });
    const pac = generateSelectivePac(['example.com'], '192.168.1.100');

    expect(pac).toContain(':9999');
  });
});

describe('getAllPacFiles', () => {
  beforeEach(() => {
    resetConfig();
    updateConfig({ socks5Port: 1080, httpProxyPort: 8080 });
  });

  afterEach(() => {
    resetConfig();
  });

  it('should return array of PAC files', () => {
    const files = getAllPacFiles('192.168.1.100');

    expect(Array.isArray(files)).toBe(true);
    expect(files.length).toBe(3);
  });

  it('should include SOCKS5 PAC file', () => {
    const files = getAllPacFiles('192.168.1.100');
    const socks5File = files.find(f => f.filename === 'revamp-socks5.pac');

    expect(socks5File).toBeDefined();
    expect(socks5File?.content).toContain('SOCKS5');
    expect(socks5File?.mimeType).toBe('application/x-ns-proxy-autoconfig');
  });

  it('should include HTTP PAC file', () => {
    const files = getAllPacFiles('192.168.1.100');
    const httpFile = files.find(f => f.filename === 'revamp-http.pac');

    expect(httpFile).toBeDefined();
    expect(httpFile?.content).toContain('PROXY');
    expect(httpFile?.mimeType).toBe('application/x-ns-proxy-autoconfig');
  });

  it('should include combined PAC file', () => {
    const files = getAllPacFiles('192.168.1.100');
    const combinedFile = files.find(f => f.filename === 'revamp-combined.pac');

    expect(combinedFile).toBeDefined();
    expect(combinedFile?.content).toContain('SOCKS5');
    expect(combinedFile?.content).toContain('PROXY');
    expect(combinedFile?.mimeType).toBe('application/x-ns-proxy-autoconfig');
  });

  it('should include descriptions', () => {
    const files = getAllPacFiles('192.168.1.100');

    files.forEach(file => {
      expect(file.description).toBeDefined();
      expect(file.description.length).toBeGreaterThan(0);
    });
  });

  it('should use provided host in all files', () => {
    const files = getAllPacFiles('10.0.0.50');

    files.forEach(file => {
      expect(file.content).toContain('10.0.0.50');
    });
  });

  it('should use detected IP when not provided', () => {
    const files = getAllPacFiles();
    const ip = getLocalIpAddress();

    files.forEach(file => {
      expect(file.content).toContain(ip);
    });
  });
});
