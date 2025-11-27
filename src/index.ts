/**
 * Revamp - Legacy Browser Compatibility Proxy
 * 
 * A SOCKS5 proxy that transforms modern web content for older devices
 * like iPads and iPods running iOS 9+ (iPad 2) or iOS 11+.
 */

import { getConfig, updateConfig, type RevampConfig } from './config/index.js';
import { createHttpProxy, createSocks5Proxy } from './proxy/index.js';
import { generateCA, getCACert } from './certs/index.js';
import { clearCache, getCacheStats } from './cache/index.js';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
║   Transform modern web for iOS 11 and other legacy devices    ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
`);
}

function printSetupInstructions(config: RevampConfig): void {
  const caCertPath = join(config.certDir, config.caCertFile);
  
  console.log(`
📱 Device Setup Instructions:
────────────────────────────────────────────────────────────────

1. Install the CA Certificate on your device:
   - Transfer the certificate file to your device:
     ${caCertPath}
   
   - On iOS: Open the file → Install Profile → Trust Certificate
     Settings → General → About → Certificate Trust Settings
     Enable trust for "Revamp Proxy CA"

2. Configure SOCKS5 Proxy:
   - Go to Settings → Wi-Fi → Your Network → Configure Proxy
   - Select "Manual"
   - Server: Your computer's IP address
   - Port: ${config.socks5Port}
   - Authentication: Off

3. Alternative: HTTP Proxy (if SOCKS5 not available):
   - Server: Your computer's IP address  
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
      httpServer = createHttpProxy(config.httpProxyPort);
      
      // Start SOCKS5 proxy
      console.log('🧦 Starting SOCKS5 proxy...');
      socks5Server = createSocks5Proxy(config.socks5Port, config.httpProxyPort);
      
      // Print setup instructions
      printSetupInstructions(config);
      
      console.log('✅ Revamp is ready!');
      console.log(`
🎯 Proxy Status:
   SOCKS5: localhost:${config.socks5Port}
   HTTP:   localhost:${config.httpProxyPort}
   
🔧 Features:
   Transform JS:   ${config.transformJs ? '✅' : '❌'}
   Transform CSS:  ${config.transformCss ? '✅' : '❌'}
   Transform HTML: ${config.transformHtml ? '✅' : '❌'}
   Remove Ads:     ${config.removeAds ? '✅' : '❌'}
   Remove Tracking:${config.removeTracking ? '✅' : '❌'}
   Inject Polyfills: ${config.injectPolyfills ? '✅' : '❌'}
   Cache Enabled:  ${config.cacheEnabled ? '✅' : '❌'}

📊 Target Browsers: ${config.targets.join(', ')}
`);
    },
    
    stop(): void {
      console.log('🛑 Stopping Revamp...');
      
      if (httpServer) {
        httpServer.close();
        httpServer = null;
      }
      
      if (socks5Server) {
        socks5Server.close();
        socks5Server = null;
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
