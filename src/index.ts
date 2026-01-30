#!/usr/bin/env node
/**
 * Revamp - Legacy Browser Compatibility Proxy
 *
 * A SOCKS5 proxy that transforms modern web content for older devices
 * like iPads and iPods running iOS 9+ (iPad 2) or iOS 11+.
 */

import { getConfig, updateConfig, CLIENT_CONFIG_OPTIONS, type RevampConfig } from './config/index.js';
import { createHttpProxy, createSocks5Proxy } from './proxy/index.js';
import { createCaptivePortal } from './portal/index.js';
import { generateCA, getCACert } from './certs/index.js';
import { clearCache, getCacheStats } from './cache/index.js';
import { initializePluginSystem, shutdownPluginSystem } from './plugins/index.js';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';

// Get local IP addresses for LAN access
function getLocalIPs(): string[] {
  const nets = networkInterfaces();
  const ips: string[] = [];

  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      // Skip internal (loopback) and non-IPv4 addresses
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }

  return ips;
}

// Generate features status display from CLIENT_CONFIG_OPTIONS
function generateFeaturesDisplay(config: RevampConfig): string {
  return CLIENT_CONFIG_OPTIONS.map((opt) => {
    const value = config[opt.key as keyof RevampConfig] as boolean;
    const icon = value ? '✅' : '❌';
    return `   ${opt.label}: ${icon}`;
  }).join('\n');
}

function printBanner(): void {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   ██████╗ ███████╗██╗   ██╗ █████╗ ███╗   ███╗██████╗        ║
║   ██╔══██╗██╔════╝██║   ██║██╔══██╗████╗ ████║██╔══██╗       ║
║   ██████╔╝█████╗  ██║   ██║███████║██╔████╔██║██████╔╝       ║
║   ██╔══██╗██╔══╝  ╚██╗ ██╔╝██╔══██║██║╚██╔╝██║██╔═══╝        ║
║   ██║  ██║███████╗ ╚████╔╝ ██║  ██║██║ ╚═╝ ██║██║            ║
║   ╚═╝  ╚═╝╚══════╝  ╚═══╝  ╚═╝  ╚═╝╚═╝     ╚═╝╚═╝            ║
║                                                               ║
║   Legacy Browser Compatibility Proxy                          ║
║   Transform modern web for iOS 9+ (iPad 2) and legacy devices ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
`);
}

function printSetupInstructions(config: RevampConfig): void {
  const caCertPath = join(config.certDir, config.caCertFile);
  const localIPs = getLocalIPs();
  const ipList = localIPs.length > 0 ? localIPs.join(', ') : 'Unable to detect';
  const portalUrl = `http://${localIPs[0] || 'YOUR_IP'}:${config.captivePortalPort}`;

  console.log(`
📱 Device Setup Instructions:
────────────────────────────────────────────────────────────────

🌐 Your Local IP Address(es): ${ipList}

🔗 Easy Setup: Open this URL on your device:
   ${portalUrl}

1. Install the CA Certificate on your device:
   - Open the URL above on your device to download certificate
   - Or transfer the certificate file manually:
     ${caCertPath}

   - On iOS: Settings → General → VPN & Device Management
     Install profile, then go to:
     Settings → General → About → Certificate Trust Settings
     Enable trust for "Revamp Proxy CA"

2. Configure SOCKS5 Proxy:
   - Go to Settings → Wi-Fi → Your Network → Configure Proxy
   - Select "Manual"
   - Server: ${localIPs[0] || 'Your computer IP'}
   - Port: ${config.socks5Port}
   - Authentication: Off

3. Alternative: HTTP Proxy (if SOCKS5 not available):
   - Server: ${localIPs[0] || 'Your computer IP'}
   - Port: ${config.httpProxyPort}

────────────────────────────────────────────────────────────────
`);
}

export interface RevampServer {
  start(): void;
  stop(): void;
  getConfig(): RevampConfig;
  updateConfig(config: Partial<RevampConfig>): void;
  clearCache(): void;
  getCacheStats(): { memoryEntries: number; memorySize: number };
}

export function createRevampServer(configOverrides?: Partial<RevampConfig>): RevampServer {
  let httpServer: ReturnType<typeof createHttpProxy> | null = null;
  let socks5Server: ReturnType<typeof createSocks5Proxy> | null = null;
  let portalServer: ReturnType<typeof createCaptivePortal> | null = null;

  if (configOverrides) {
    updateConfig(configOverrides);
  }

  return {
    start(): void {
      const config = getConfig();

      printBanner();

      // Ensure directories exist
      if (!existsSync(config.cacheDir)) {
        mkdirSync(config.cacheDir, { recursive: true });
      }
      if (!existsSync(config.certDir)) {
        mkdirSync(config.certDir, { recursive: true });
      }

      // Generate CA certificate
      console.log('🔐 Initializing certificates...');
      generateCA();

      // Start HTTP proxy first (SOCKS5 routes through it)
      console.log('🌐 Starting HTTP proxy...');
      httpServer = createHttpProxy(config.httpProxyPort, config.bindAddress);

      // Start SOCKS5 proxy
      console.log('🧦 Starting SOCKS5 proxy...');
      socks5Server = createSocks5Proxy(config.socks5Port, config.httpProxyPort, config.bindAddress);

      // Start captive portal for easy certificate installation
      console.log('📜 Starting captive portal...');
      portalServer = createCaptivePortal(config.captivePortalPort, config.bindAddress);

      // Initialize plugin system
      console.log('🔌 Initializing plugin system...');
      initializePluginSystem().catch((err) => {
        console.error('Failed to initialize plugins:', err);
      });

      // Print setup instructions
      printSetupInstructions(config);

      const localIPs = getLocalIPs();
      console.log('✅ Revamp is ready!');
      console.log(`
🎯 Proxy Status:
   SOCKS5:  ${config.bindAddress}:${config.socks5Port}
   HTTP:    ${config.bindAddress}:${config.httpProxyPort}
   Portal:  http://${localIPs[0] || 'localhost'}:${config.captivePortalPort}

🔧 Features:
${generateFeaturesDisplay(config)}

📊 Target Browsers: ${config.targets.join(', ')}
`);
    },

    stop(): void {
      console.log('🛑 Stopping Revamp...');

      // Shutdown plugins first
      console.log('🔌 Shutting down plugins...');
      shutdownPluginSystem().catch((err) => {
        console.error('Failed to shutdown plugins:', err);
      });

      if (httpServer) {
        httpServer.close();
        httpServer = null;
      }

      if (socks5Server) {
        socks5Server.close();
        socks5Server = null;
      }

      if (portalServer) {
        portalServer.close();
        portalServer = null;
      }

      console.log('👋 Revamp stopped');
    },

    getConfig,

    updateConfig(partial: Partial<RevampConfig>): void {
      updateConfig(partial);
    },

    clearCache,
    getCacheStats,
  };
}

// CLI entry point
if (process.argv[1]?.includes('index')) {
  const server = createRevampServer();

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n');
    server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    server.stop();
    process.exit(0);
  });

  server.start();
}

export { getConfig, updateConfig, type RevampConfig } from './config/index.js';
export { getCACert } from './certs/index.js';
