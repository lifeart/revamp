/**
 * Remote Service Worker Server
 *
 * Manages WebSocket connections from legacy devices and executes Service Workers
 * in a headless Playwright Chromium instance. This allows modern SWs to run
 * remotely while the legacy device handles network requests.
 *
 * Architecture:
 * - Each connected device gets its own SW execution context
 * - SWs are registered in a dedicated Playwright browser context
 * - Fetch events from SWs are forwarded to the device via WebSocket
 * - Device executes fetches and returns responses via WebSocket
 * - Server forwards responses back to the SW
 *
 * Note: This module requires 'ws' and 'playwright' packages.
 *
 * @module proxy/remote-sw-server
 */

import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';

// =============================================================================
// Types
// =============================================================================

/** Playwright types (imported dynamically) */
interface PlaywrightBrowser {
  newContext(options?: Record<string, unknown>): Promise<PlaywrightContext>;
  close(): Promise<void>;
  isConnected(): boolean;
}

interface PlaywrightContext {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
  route(url: string | RegExp, handler: (route: PlaywrightRoute) => void): Promise<void>;
}

interface PlaywrightPage {
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  evaluate<T>(fn: string | ((...args: any[]) => T), ...args: any[]): Promise<T>;
  exposeFunction(name: string, fn: (...args: unknown[]) => unknown): Promise<void>;
  close(): Promise<void>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  url(): string;
}

interface PlaywrightRoute {
  request(): { url(): string; method(): string; headers(): Record<string, string>; postData(): string | null };
  fulfill(options: { status: number; headers?: Record<string, string>; body?: string | Buffer }): Promise<void>;
  continue(): Promise<void>;
  abort(reason?: string): Promise<void>;
}

/** Client connection state */
interface ClientConnection {
  /** Unique client ID */
  clientId: string;
  /** WebSocket connection */
  ws: unknown;
  /** Client origin */
  origin: string;
  /** Client user agent */
  userAgent: string;
  /** Registered service workers for this client */
  serviceWorkers: Map<string, ServiceWorkerState>;
  /** Pending fetch requests awaiting response from client */
  pendingFetches: Map<string, PendingFetch>;
  /** Connection timestamp */
  connectedAt: number;
  /** Playwright browser context for this client */
  browserContext: PlaywrightContext | null;
  /** Playwright page for SW execution */
  swPage: PlaywrightPage | null;
}

/** Service Worker state */
interface ServiceWorkerState {
  /** Script URL or inline indicator */
  scriptURL: string;
  /** SW scope */
  scope: string;
  /** Whether using inline code */
  isInline: boolean;
  /** Inline code if applicable */
  inlineCode?: string;
  /** Registration ID */
  registrationId: string;
  /** Whether SW is active */
  isActive: boolean;
}

/** Pending fetch request */
interface PendingFetch {
  requestId: string;
  resolve: (response: FetchResponseData) => void;
  reject: (error: Error) => void;
  timestamp: number;
  timeoutId: NodeJS.Timeout;
}

/** Fetch response data from client */
interface FetchResponseData {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  bodyEncoding: 'base64' | 'text';
}

/** WebSocket message types */
interface WSMessage {
  type: string;
  requestId?: string;
  [key: string]: unknown;
}

// =============================================================================
// Constants
// =============================================================================

const FETCH_TIMEOUT = 30000; // 30 seconds
const PING_INTERVAL = 30000; // 30 seconds
const CONNECTION_TIMEOUT = 60000; // 1 minute without activity
const WS_OPEN = 1;

// =============================================================================
// Dynamic Module Imports
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let WebSocketServerClass: (new (options: { noServer: boolean }) => unknown) | null = null;
let wsModuleLoaded = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let playwrightChromium: { launch(options?: Record<string, unknown>): Promise<PlaywrightBrowser> } | null = null;
let playwrightLoaded = false;
let playwrightBrowser: PlaywrightBrowser | null = null;

async function loadWsModule(): Promise<boolean> {
  if (wsModuleLoaded) {
    return WebSocketServerClass !== null;
  }
  wsModuleLoaded = true;

  try {
    const wsModule = await import("ws");
    WebSocketServerClass = wsModule.WebSocketServer;
    return true;
  } catch {
    console.warn('[Remote SW Server] ws module not available. Install with: npm install ws @types/ws');
    return false;
  }
}

async function loadPlaywright(): Promise<boolean> {
  if (playwrightLoaded) {
    return playwrightChromium !== null;
  }
  playwrightLoaded = true;

  try {
    const playwright = await import('playwright');
    playwrightChromium = playwright.chromium;
    return true;
  } catch {
    console.warn('[Remote SW Server] playwright module not available. Install with: npm install playwright');
    return false;
  }
}

async function getBrowser(): Promise<PlaywrightBrowser | null> {
  if (!playwrightChromium) {
    const loaded = await loadPlaywright();
    if (!loaded || !playwrightChromium) return null;
  }

  if (playwrightBrowser && playwrightBrowser.isConnected()) {
    return playwrightBrowser;
  }

  try {
    console.log('[Remote SW Server] Launching Playwright Chromium...');
    playwrightBrowser = await playwrightChromium.launch({
      headless: true,
      args: [
        '--disable-web-security',
        '--allow-running-insecure-content',
        '--disable-features=IsolateOrigins,site-per-process'
      ]
    });
    console.log('[Remote SW Server] Playwright Chromium launched');
    return playwrightBrowser;
  } catch (error) {
    console.error('[Remote SW Server] Failed to launch Playwright:', error);
    return null;
  }
}

// Helper functions for WebSocket operations
function wsReadyState(ws: unknown): number {
  return (ws as { readyState: number }).readyState;
}

function wsSend(ws: unknown, data: string): void {
  (ws as { send: (data: string) => void }).send(data);
}

function wsClose(ws: unknown, code?: number, reason?: string): void {
  (ws as { close: (code?: number, reason?: string) => void }).close(code, reason);
}

function wsOn(ws: unknown, event: string, callback: (...args: unknown[]) => void): void {
  (ws as { on: (event: string, callback: (...args: unknown[]) => void) => void }).on(event, callback);
}

// =============================================================================
// Remote SW Server Class
// =============================================================================

export class RemoteSwServer {
  private wss: unknown = null;
  private clients: Map<string, ClientConnection> = new Map();
  private connectionsBySocket: WeakMap<object, string> = new WeakMap();
  private pingInterval: NodeJS.Timeout | null = null;
  private isShuttingDown = false;

  /**
   * Initialize the WebSocket server
   */
  async initialize(): Promise<void> {
    if (this.wss) {
      console.log('[Remote SW Server] Already initialized');
      return;
    }

    const hasWs = await loadWsModule();
    if (!hasWs || !WebSocketServerClass) {
      console.warn('[Remote SW Server] Cannot initialize - ws module not available');
      return;
    }

    // Pre-load Playwright
    await loadPlaywright();

    this.wss = new WebSocketServerClass({ noServer: true });
    this.setupServerEvents();
    this.startPingInterval();

    console.log('[Remote SW Server] Initialized (noServer mode)');
  }

  /**
   * Handle HTTP upgrade request for WebSocket
   */
  async handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    if (!this.wss) {
      const hasWs = await loadWsModule();
      if (!hasWs || !WebSocketServerClass) {
        console.warn('[Remote SW Server] Cannot handle upgrade - ws module not available');
        socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n');
        return;
      }

      console.log('[Remote SW Server] Auto-initializing on upgrade');
      this.wss = new WebSocketServerClass({ noServer: true });
      this.setupServerEvents();
      this.startPingInterval();
    }

    const wss = this.wss as {
      handleUpgrade: (
        request: IncomingMessage,
        socket: Duplex,
        head: Buffer,
        callback: (ws: unknown) => void
      ) => void;
      emit: (event: string, ...args: unknown[]) => void;
    };

    wss.handleUpgrade(request, socket, head, (ws: unknown) => {
      wss.emit('connection', ws, request);
    });
  }

  /**
   * Check if the server has been initialized
   */
  isInitialized(): boolean {
    return this.wss !== null;
  }

  /**
   * Get the number of connected clients
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Get list of connected clients (for debugging/monitoring)
   */
  getConnectedClients(): Array<{ clientId: string; origin: string; swCount: number }> {
    const result: Array<{ clientId: string; origin: string; swCount: number }> = [];
    this.clients.forEach((client, clientId) => {
      result.push({
        clientId,
        origin: client.origin,
        swCount: client.serviceWorkers.size
      });
    });
    return result;
  }

  /**
   * Shutdown the server
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    // Close all client connections
    for (const [clientId, client] of this.clients) {
      this.sendToClient(clientId, {
        type: 'server_shutdown',
        reason: 'Server is shutting down'
      });
      await this.cleanupClientPlaywright(client);
      wsClose(client.ws, 1001, 'Server shutdown');
    }

    this.clients.clear();

    // Close browser
    if (playwrightBrowser) {
      try {
        await playwrightBrowser.close();
      } catch {
        // Ignore
      }
      playwrightBrowser = null;
    }

    if (this.wss) {
      (this.wss as { close: () => void }).close();
      this.wss = null;
    }

    console.log('[Remote SW Server] Shutdown complete');
  }

  // ===========================================================================
  // Private Methods - Server Setup
  // ===========================================================================

  private setupServerEvents(): void {
    if (!this.wss) return;

    const wss = this.wss as { on: (event: string, callback: (...args: unknown[]) => void) => void };

    wss.on('connection', (ws: unknown, request: unknown) => {
      this.handleConnection(ws, request as IncomingMessage);
    });

    wss.on('error', (error: unknown) => {
      console.error('[Remote SW Server] Server error:', (error as Error).message);
    });
  }

  private startPingInterval(): void {
    this.pingInterval = setInterval(() => {
      const now = Date.now();

      this.clients.forEach((client, clientId) => {
        const lastActivity = this.getClientLastActivity(client);
        if (now - lastActivity > CONNECTION_TIMEOUT) {
          console.log('[Remote SW Server] Client ' + clientId + ' timed out');
          this.disconnectClient(clientId, 'Connection timeout');
          return;
        }

        this.sendToClient(clientId, {
          type: 'ping',
          timestamp: now
        });
      });
    }, PING_INTERVAL);
  }

  private getClientLastActivity(client: ClientConnection): number {
    let lastActivity = client.connectedAt;
    client.pendingFetches.forEach((fetch) => {
      if (fetch.timestamp > lastActivity) {
        lastActivity = fetch.timestamp;
      }
    });
    return lastActivity;
  }

  // ===========================================================================
  // Private Methods - Connection Handling
  // ===========================================================================

  private handleConnection(ws: unknown, request: IncomingMessage): void {
    console.log('[Remote SW Server] New connection from ' + request.socket.remoteAddress);

    wsOn(ws, 'message', (data: unknown) => {
      try {
        const message: WSMessage = JSON.parse(String(data));
        const clientId = this.connectionsBySocket.get(ws as object);

        if (message.type === 'client_init') {
          this.handleClientInit(ws, message);
        } else if (clientId) {
          this.handleClientMessage(clientId, message);
        } else {
          console.warn('[Remote SW Server] Message from uninitialized client');
        }
      } catch (e) {
        console.error('[Remote SW Server] Failed to parse message:', e);
      }
    });

    wsOn(ws, 'close', (code: unknown, reason: unknown) => {
      const clientId = this.connectionsBySocket.get(ws as object);
      if (clientId) {
        console.log('[Remote SW Server] Client ' + clientId + ' disconnected: ' + code + ' ' + String(reason));
        this.cleanupClient(clientId);
      }
    });

    wsOn(ws, 'error', (error: unknown) => {
      const clientId = this.connectionsBySocket.get(ws as object);
      console.error('[Remote SW Server] WebSocket error for ' + (clientId || 'unknown') + ':', (error as Error).message);
    });
  }

  private handleClientInit(ws: unknown, message: WSMessage): void {
    const clientId = message.clientId as string;
    const origin = (message.origin as string) || 'unknown';
    const userAgent = (message.userAgent as string) || 'unknown';

    if (this.clients.has(clientId)) {
      this.cleanupClient(clientId);
    }

    const client: ClientConnection = {
      clientId,
      ws,
      origin,
      userAgent,
      serviceWorkers: new Map(),
      pendingFetches: new Map(),
      connectedAt: Date.now(),
      browserContext: null,
      swPage: null
    };

    this.clients.set(clientId, client);
    this.connectionsBySocket.set(ws as object, clientId);

    console.log('[Remote SW Server] Client initialized: ' + clientId + ' from ' + origin);

    this.sendToClient(clientId, {
      type: 'init_ack',
      clientId,
      serverTime: Date.now()
    });
  }

  private handleClientMessage(clientId: string, message: WSMessage): void {
    const client = this.clients.get(clientId);
    if (!client) {
      console.warn('[Remote SW Server] Message for unknown client: ' + clientId);
      return;
    }

    switch (message.type) {
      case 'sw_register':
        this.handleSwRegister(client, message);
        break;

      case 'sw_unregister':
        this.handleSwUnregister(client, message);
        break;

      case 'sw_update':
        this.handleSwUpdate(client, message);
        break;

      case 'sw_postmessage':
        this.handleSwPostMessage(client, message);
        break;

      case 'fetch_response':
        this.handleFetchResponse(client, message);
        break;

      case 'pong':
        client.connectedAt = Date.now();
        break;

      default:
        console.warn('[Remote SW Server] Unknown message type: ' + message.type);
    }
  }

  // ===========================================================================
  // Private Methods - Playwright Integration
  // ===========================================================================

  private async setupClientPlaywright(client: ClientConnection): Promise<boolean> {
    if (client.browserContext && client.swPage) {
      return true;
    }

    const browser = await getBrowser();
    if (!browser) {
      console.error('[Remote SW Server] Failed to get browser for client ' + client.clientId);
      return false;
    }

    try {
      // Create a new browser context for this client
      client.browserContext = await browser.newContext({
        serviceWorkers: 'allow',
        bypassCSP: true,
        ignoreHTTPSErrors: true
      });

      // Set up route interception to forward requests to the legacy device
      await client.browserContext.route('**/*', async (route) => {
        const request = route.request();
        const url = request.url();

        // Skip data/blob URLs
        if (url.startsWith('data:') || url.startsWith('blob:')) {
          await route.continue();
          return;
        }

        try {
          // Request fetch from the legacy device
          const response = await this.requestFetchFromClient(
            client.clientId,
            '/',
            {
              url,
              method: request.method(),
              headers: request.headers(),
              body: request.postData() || undefined
            }
          );

          // Decode response body
          let body: Buffer;
          if (response.bodyEncoding === 'base64') {
            body = Buffer.from(response.body, 'base64');
          } else {
            body = Buffer.from(response.body, 'utf-8');
          }

          await route.fulfill({
            status: response.status,
            headers: response.headers,
            body
          });
        } catch (error) {
          console.error('[Remote SW Server] Route error for ' + url + ':', error);
          await route.abort('failed');
        }
      });

      // Create a page for SW execution
      client.swPage = await client.browserContext.newPage();

      // Expose function for SW to communicate back
      await client.swPage.exposeFunction('__revampSwMessage', (data: unknown) => {
        this.sendToClient(client.clientId, {
          type: 'sw_message',
          data
        });
      });

      console.log('[Remote SW Server] Playwright context created for client ' + client.clientId);
      return true;
    } catch (error) {
      console.error('[Remote SW Server] Failed to setup Playwright for ' + client.clientId + ':', error);
      await this.cleanupClientPlaywright(client);
      return false;
    }
  }

  private async cleanupClientPlaywright(client: ClientConnection): Promise<void> {
    if (client.swPage) {
      try {
        await client.swPage.close();
      } catch {
        // Ignore
      }
      client.swPage = null;
    }

    if (client.browserContext) {
      try {
        await client.browserContext.close();
      } catch {
        // Ignore
      }
      client.browserContext = null;
    }
  }

  // ===========================================================================
  // Private Methods - Service Worker Management
  // ===========================================================================

  private async handleSwRegister(client: ClientConnection, message: WSMessage): Promise<void> {
    const scope = message.scope as string;
    const scriptURL = message.scriptURL as string;
    const scriptType = message.scriptType as string;
    const scriptCode = message.scriptCode as string;
    const requestId = message.requestId as string;

    console.log('[Remote SW Server] Registering SW for client ' + client.clientId + ', scope: ' + scope);

    const registrationId = 'sw_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

    // Setup Playwright if not already done
    const setupSuccess = await this.setupClientPlaywright(client);
    if (!setupSuccess) {
      this.sendToClient(client.clientId, {
        type: 'response',
        requestId,
        error: 'Failed to initialize Playwright browser'
      });
      return;
    }

    try {
      // Navigate to the client's origin to establish SW scope
      const targetUrl = scriptType === 'inline'
        ? client.origin + '/'
        : new URL(scriptURL).origin + '/';

      // Use a minimal HTML page to avoid any redirects or complex loading
      // First, try to go to about:blank to reset state
      try {
        await client.swPage!.goto('about:blank', { waitUntil: 'load', timeout: 5000 });
      } catch {
        // Ignore errors going to about:blank
      }

      // Set up a simple HTML page with the correct origin context
      // We'll intercept the navigation and serve a minimal page
      const minimalHtml = `<!DOCTYPE html><html><head><title>SW Host</title></head><body></body></html>`;

      // Navigate with a shorter timeout and handle navigation errors
      try {
        await client.swPage!.goto(targetUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 10000
        });
      } catch (navError) {
        // If navigation fails, we might still have a usable page context
        console.warn('[Remote SW Server] Navigation warning:', (navError as Error).message);

        // Check if we have a valid page context
        const currentUrl = client.swPage!.url();
        if (currentUrl === 'about:blank' || !currentUrl.startsWith('http')) {
          throw new Error('Failed to navigate to target origin: ' + (navError as Error).message);
        }
      }

      // Wait a moment for the page to stabilize
      await new Promise(resolve => setTimeout(resolve, 100));

      // Register the service worker with retry logic
      let registration: { scope?: string; active?: boolean; error?: string } | null = null;
      let lastError: Error | null = null;

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          // Register the service worker
          let swUrl: string;
          if (scriptType === 'inline') {
            // Create a blob URL for inline scripts
            swUrl = await client.swPage!.evaluate((code) => {
              const blob = new Blob([code as string], { type: 'application/javascript' });
              return URL.createObjectURL(blob);
            }, scriptCode);
          } else {
            swUrl = scriptURL;
          }

          // Register the SW and wait for it to be ready
          registration = await client.swPage!.evaluate(
            async (args) => {
              const { swUrl, scope } = args as { swUrl: string; scope: string };
              try {
                // @ts-expect-error - navigator.serviceWorker exists in browser
                const reg = await navigator.serviceWorker.register(swUrl, { scope });

                // Wait for the SW to be active
                await new Promise<void>((resolve, reject) => {
                  const sw = reg.installing || reg.waiting || reg.active;
                  if (!sw) {
                    reject(new Error('No service worker found'));
                    return;
                  }

                  if (sw.state === 'activated') {
                    resolve();
                    return;
                  }

                  sw.addEventListener('statechange', () => {
                    if (sw.state === 'activated') {
                      resolve();
                    } else if (sw.state === 'redundant') {
                      reject(new Error('Service worker became redundant'));
                    }
                  });

                  // Timeout after 10 seconds
                  setTimeout(() => reject(new Error('SW activation timeout')), 10000);
                });

                return {
                  scope: reg.scope,
                  active: !!reg.active
                };
              } catch (e) {
                return { error: (e as Error).message };
              }
            },
            { swUrl, scope }
          );

          // If we got here without error, break out of retry loop
          if (registration && !registration.error) {
            break;
          }

          lastError = new Error(registration?.error || 'Unknown registration error');
        } catch (evalError) {
          lastError = evalError as Error;
          const errorMessage = lastError.message || '';

          // If execution context was destroyed, try to recover
          if (errorMessage.includes('Execution context was destroyed') ||
              errorMessage.includes('navigation')) {
            console.warn('[Remote SW Server] Context destroyed on attempt ' + (attempt + 1) + ', retrying...');

            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, 500));

            // Try to navigate again
            try {
              await client.swPage!.goto(targetUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 10000
              });
              await new Promise(resolve => setTimeout(resolve, 100));
            } catch {
              // Continue to next attempt
            }
          } else {
            // Non-recoverable error
            throw lastError;
          }
        }
      }

      if (!registration || registration.error) {
        throw lastError || new Error(registration?.error || 'Failed to register service worker');
      }

      const swState: ServiceWorkerState = {
        scriptURL: scriptType === 'inline' ? 'inline-script' : scriptURL,
        scope,
        isInline: scriptType === 'inline',
        inlineCode: scriptCode,
        registrationId,
        isActive: true
      };

      client.serviceWorkers.set(scope, swState);

      this.sendToClient(client.clientId, {
        type: 'response',
        requestId,
        data: {
          registrationId,
          scope: registration.scope,
          success: true
        }
      });

      this.sendToClient(client.clientId, {
        type: 'sw_registered',
        scope,
        scriptURL: swState.scriptURL,
        registrationId
      });

      console.log('[Remote SW Server] SW registered in Playwright: ' + registrationId + ' for scope ' + scope);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[Remote SW Server] SW registration failed:', errorMessage);

      this.sendToClient(client.clientId, {
        type: 'response',
        requestId,
        error: errorMessage
      });
    }
  }

  private async handleSwUnregister(client: ClientConnection, message: WSMessage): Promise<void> {
    const scope = message.scope as string;
    const requestId = message.requestId as string;

    const swState = client.serviceWorkers.get(scope);
    if (swState && client.swPage) {
      console.log('[Remote SW Server] Unregistering SW for scope: ' + scope);

      try {
        await client.swPage.evaluate(async (s) => {
          const scope = s as string;
          // @ts-expect-error - navigator.serviceWorker exists in browser
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (const reg of registrations) {
            if (reg.scope.includes(scope)) {
              await reg.unregister();
            }
          }
        }, scope);
      } catch (error) {
        console.warn('[Remote SW Server] Error unregistering SW:', error);
      }

      client.serviceWorkers.delete(scope);
    }

    this.sendToClient(client.clientId, {
      type: 'response',
      requestId,
      data: { success: true }
    });
  }

  private async handleSwUpdate(client: ClientConnection, message: WSMessage): Promise<void> {
    const scope = message.scope as string;
    const requestId = message.requestId as string;

    if (client.swPage) {
      try {
        await client.swPage.evaluate(async (s) => {
          const scope = s as string;
          // @ts-expect-error - navigator.serviceWorker exists in browser
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (const reg of registrations) {
            if (reg.scope.includes(scope)) {
              await reg.update();
            }
          }
        }, scope);
      } catch (error) {
        console.warn('[Remote SW Server] Error updating SW:', error);
      }
    }

    this.sendToClient(client.clientId, {
      type: 'response',
      requestId,
      data: { success: true }
    });
  }

  private async handleSwPostMessage(client: ClientConnection, message: WSMessage): Promise<void> {
    const scope = message.scope as string;
    const msgData = message.message;

    const swState = client.serviceWorkers.get(scope);
    if (!swState || !client.swPage) {
      console.warn('[Remote SW Server] postMessage to unknown SW scope: ' + scope);
      return;
    }

    try {
      await client.swPage.evaluate(
        async (args) => {
          const { scope, data } = args as { scope: string; data: unknown };
          // @ts-expect-error - navigator.serviceWorker exists in browser
          const registrations = await navigator.serviceWorker.getRegistrations();
          for (const reg of registrations) {
            if (reg.scope.includes(scope) && reg.active) {
              reg.active.postMessage(data);
            }
          }
        },
        { scope, data: msgData }
      );
    } catch (error) {
      console.warn('[Remote SW Server] Error posting message to SW:', error);
    }
  }

  // ===========================================================================
  // Private Methods - Fetch Handling
  // ===========================================================================

  /**
   * Request a fetch from the client device
   */
  async requestFetchFromClient(
    clientId: string,
    scope: string,
    request: {
      url: string;
      method: string;
      headers: Record<string, string>;
      body?: string;
      credentials?: string;
    }
  ): Promise<FetchResponseData> {
    const client = this.clients.get(clientId);
    if (!client) {
      throw new Error('Client not found: ' + clientId);
    }

    const requestId = 'fetch_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        client.pendingFetches.delete(requestId);
        reject(new Error('Fetch request timed out'));
      }, FETCH_TIMEOUT);

      const pending: PendingFetch = {
        requestId,
        resolve,
        reject,
        timestamp: Date.now(),
        timeoutId
      };

      client.pendingFetches.set(requestId, pending);

      this.sendToClient(clientId, {
        type: 'fetch_request',
        requestId,
        scope,
        url: request.url,
        method: request.method,
        headers: request.headers,
        body: request.body,
        credentials: request.credentials
      });
    });
  }

  private handleFetchResponse(client: ClientConnection, message: WSMessage): void {
    const requestId = message.requestId as string;
    const pending = client.pendingFetches.get(requestId);

    if (!pending) {
      console.warn('[Remote SW Server] Response for unknown fetch request: ' + requestId);
      return;
    }

    clearTimeout(pending.timeoutId);
    client.pendingFetches.delete(requestId);

    if (message.error) {
      pending.reject(new Error(message.error as string));
    } else {
      pending.resolve(message.response as FetchResponseData);
    }
  }

  // ===========================================================================
  // Private Methods - Client Communication
  // ===========================================================================

  private sendToClient(clientId: string, message: Record<string, unknown>): boolean {
    const client = this.clients.get(clientId);
    if (!client || wsReadyState(client.ws) !== WS_OPEN) {
      return false;
    }

    try {
      wsSend(client.ws, JSON.stringify(message));
      return true;
    } catch (e) {
      console.error('[Remote SW Server] Failed to send to client ' + clientId + ':', e);
      return false;
    }
  }

  private disconnectClient(clientId: string, reason: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      this.sendToClient(clientId, {
        type: 'disconnect',
        reason
      });
      wsClose(client.ws, 1000, reason);
      this.cleanupClient(clientId);
    }
  }

  private async cleanupClient(clientId: string): Promise<void> {
    const client = this.clients.get(clientId);
    if (client) {
      // Clear pending fetch timeouts
      client.pendingFetches.forEach((pending) => {
        clearTimeout(pending.timeoutId);
        pending.reject(new Error('Client disconnected'));
      });

      // Clean up Playwright resources
      await this.cleanupClientPlaywright(client);

      this.clients.delete(clientId);
      console.log('[Remote SW Server] Cleaned up client: ' + clientId);
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

export const remoteSwServer = new RemoteSwServer();

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Check if a request path is for the remote SW WebSocket endpoint
 */
export function isRemoteSwEndpoint(path: string): boolean {
  return path === '/__revamp__/sw/remote' || path.startsWith('/__revamp__/sw/remote?');
}

/**
 * Get status information about the remote SW server
 */
export function getRemoteSwStatus(): {
  initialized: boolean;
  clientCount: number;
  clients: Array<{ clientId: string; origin: string; swCount: number }>;
  playwrightAvailable: boolean;
  browserConnected: boolean;
} {
  return {
    initialized: remoteSwServer.isInitialized(),
    clientCount: remoteSwServer.getClientCount(),
    clients: remoteSwServer.getConnectedClients(),
    playwrightAvailable: playwrightChromium !== null,
    browserConnected: playwrightBrowser !== null && playwrightBrowser.isConnected()
  };
}
