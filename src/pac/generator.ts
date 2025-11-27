/**
 * PAC (Proxy Auto-Config) File Generator
 * Generates .pac files for easy device configuration
 */

import { getConfig } from '../config/index.js';
import * as os from 'node:os';

/**
 * Get the local IP address of the machine
 */
export function getLocalIpAddress(): string {
  const interfaces = os.networkInterfaces();

  for (const name of Object.keys(interfaces)) {
    const netInterface = interfaces[name];
    if (!netInterface) continue;

    for (const iface of netInterface) {
      // Skip internal and non-IPv4 addresses
      if (iface.internal || iface.family !== 'IPv4') continue;

      // Prefer addresses in common LAN ranges
      if (iface.address.startsWith('192.168.') ||
          iface.address.startsWith('10.') ||
          iface.address.startsWith('172.')) {
        return iface.address;
      }
    }
  }

  return '127.0.0.1';
}

/**
 * Generate a PAC file for SOCKS5 proxy
 */
export function generateSocks5Pac(proxyHost?: string, proxyPort?: number): string {
  const config = getConfig();
  const host = proxyHost || getLocalIpAddress();
  const port = proxyPort || config.socks5Port;

  return `// Revamp SOCKS5 Proxy Auto-Config
// Generated: ${new Date().toISOString()}
// Proxy: SOCKS5 ${host}:${port}

function FindProxyForURL(url, host) {
  // Bypass proxy for localhost
  if (isPlainHostName(host) ||
      shExpMatch(host, "localhost") ||
      shExpMatch(host, "127.0.0.1") ||
      shExpMatch(host, "*.local")) {
    return "DIRECT";
  }

  // Use SOCKS5 proxy for all other traffic
  return "SOCKS5 ${host}:${port}; SOCKS ${host}:${port}; DIRECT";
}
`;
}

/**
 * Generate a PAC file for HTTP proxy
 */
export function generateHttpPac(proxyHost?: string, proxyPort?: number): string {
  const config = getConfig();
  const host = proxyHost || getLocalIpAddress();
  const port = proxyPort || config.httpProxyPort;

  return `// Revamp HTTP Proxy Auto-Config
// Generated: ${new Date().toISOString()}
// Proxy: HTTP ${host}:${port}

function FindProxyForURL(url, host) {
  // Bypass proxy for localhost
  if (isPlainHostName(host) ||
      shExpMatch(host, "localhost") ||
      shExpMatch(host, "127.0.0.1") ||
      shExpMatch(host, "*.local")) {
    return "DIRECT";
  }

  // Use HTTP proxy for all other traffic
  return "PROXY ${host}:${port}; DIRECT";
}
`;
}

/**
 * Generate a PAC file that uses SOCKS5 for HTTPS and HTTP proxy for HTTP
 */
export function generateCombinedPac(proxyHost?: string): string {
  const config = getConfig();
  const host = proxyHost || getLocalIpAddress();

  return `// Revamp Combined Proxy Auto-Config
// Generated: ${new Date().toISOString()}
// SOCKS5: ${host}:${config.socks5Port}
// HTTP: ${host}:${config.httpProxyPort}

function FindProxyForURL(url, host) {
  // Bypass proxy for localhost
  if (isPlainHostName(host) ||
      shExpMatch(host, "localhost") ||
      shExpMatch(host, "127.0.0.1") ||
      shExpMatch(host, "*.local")) {
    return "DIRECT";
  }

  // Use SOCKS5 for HTTPS (better TLS handling)
  if (url.substring(0, 6) === "https:") {
    return "SOCKS5 ${host}:${config.socks5Port}; SOCKS ${host}:${config.socks5Port}; DIRECT";
  }

  // Use HTTP proxy for HTTP traffic
  return "PROXY ${host}:${config.httpProxyPort}; DIRECT";
}
`;
}

/**
 * Generate PAC file with selective proxying (only proxy specific domains)
 */
export function generateSelectivePac(
  domains: string[],
  proxyHost?: string,
  proxyPort?: number
): string {
  const config = getConfig();
  const host = proxyHost || getLocalIpAddress();
  const port = proxyPort || config.socks5Port;

  const domainChecks = domains
    .map(d => `    shExpMatch(host, "*${d}")`)
    .join(' ||\n');

  return `// Revamp Selective Proxy Auto-Config
// Generated: ${new Date().toISOString()}
// Proxy: SOCKS5 ${host}:${port}
// Proxied domains: ${domains.length}

function FindProxyForURL(url, host) {
  // Bypass proxy for localhost
  if (isPlainHostName(host) ||
      shExpMatch(host, "localhost") ||
      shExpMatch(host, "127.0.0.1") ||
      shExpMatch(host, "*.local")) {
    return "DIRECT";
  }

  // Only proxy specific domains
  if (
${domainChecks}
  ) {
    return "SOCKS5 ${host}:${port}; SOCKS ${host}:${port}; DIRECT";
  }

  // Direct connection for everything else
  return "DIRECT";
}
`;
}

export interface PacFileInfo {
  filename: string;
  content: string;
  description: string;
  mimeType: string;
}

/**
 * Get all PAC file variants
 */
export function getAllPacFiles(proxyHost?: string): PacFileInfo[] {
  const host = proxyHost || getLocalIpAddress();
  const config = getConfig();

  return [
    {
      filename: 'revamp-socks5.pac',
      content: generateSocks5Pac(host),
      description: `SOCKS5 proxy at ${host}:${config.socks5Port}`,
      mimeType: 'application/x-ns-proxy-autoconfig'
    },
    {
      filename: 'revamp-http.pac',
      content: generateHttpPac(host),
      description: `HTTP proxy at ${host}:${config.httpProxyPort}`,
      mimeType: 'application/x-ns-proxy-autoconfig'
    },
    {
      filename: 'revamp-combined.pac',
      content: generateCombinedPac(host),
      description: `SOCKS5 for HTTPS, HTTP proxy for HTTP`,
      mimeType: 'application/x-ns-proxy-autoconfig'
    }
  ];
}
