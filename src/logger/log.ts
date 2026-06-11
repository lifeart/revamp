/**
 * Leveled, swappable logger.
 *
 * Levels: debug < info < warn < error < silent. The default level is `info`,
 * so `log.debug` output is suppressed unless explicitly enabled.
 *
 * The default backend writes through to the global `console` (debug/info →
 * console.log, warn → console.warn, error → console.error) so existing test
 * spies on console methods keep observing output. The console property is
 * looked up at call time — not captured at module load — so spies installed
 * after this module is imported are still hit.
 *
 * Printf-style format strings (`log.info('%s', sanitizeForLog(value))`) pass
 * through unchanged: keep format strings constant and route untrusted values
 * through `sanitizeForLog` at the call site, exactly as with `console.*`.
 *
 * Embedders can reroute or silence all output with `setLoggerBackend()` /
 * `setLogLevel()`; this module deliberately has no imports so it can be
 * pulled in from anywhere without creating dependency cycles.
 *
 * @module logger/log
 */

/** All recognized log levels, ordered from most to least verbose. */
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/** A swappable sink for log output. Each method receives console-style args. */
export interface LoggerBackend {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50,
};

/**
 * Default backend: write through to the global console. Calls are wrapped in
 * arrow functions (rather than bound references) so `vi.spyOn(console, ...)`
 * installed at any point intercepts them.
 */
export const consoleLoggerBackend: LoggerBackend = {
  debug: (...args: unknown[]): void => {
    console.log(...args);
  },
  info: (...args: unknown[]): void => {
    console.log(...args);
  },
  warn: (...args: unknown[]): void => {
    console.warn(...args);
  },
  error: (...args: unknown[]): void => {
    console.error(...args);
  },
};

let currentLevel: LogLevel = 'info';
let currentBackend: LoggerBackend = consoleLoggerBackend;

/** Type guard for validating user-supplied level strings (CLI/env). */
export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value);
}

/**
 * Set the minimum level that produces output. `silent` disables everything.
 * Throws on unrecognized values so misconfiguration fails loudly.
 */
export function setLogLevel(level: LogLevel): void {
  if (!isLogLevel(level)) {
    throw new Error(
      `Invalid log level "${String(level)}": expected one of ${LOG_LEVELS.join(', ')}`
    );
  }
  currentLevel = level;
}

/** Get the currently active log level. */
export function getLogLevel(): LogLevel {
  return currentLevel;
}

/**
 * Replace the output backend (e.g. to route logs into a file or a host
 * application's logger). Pass `consoleLoggerBackend` to restore the default.
 * Level filtering happens before the backend is invoked.
 */
export function setLoggerBackend(backend: LoggerBackend): void {
  currentBackend = backend;
}

function isEnabled(level: Exclude<LogLevel, 'silent'>): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[currentLevel];
}

/** Leveled logging entry points. Drop-in for console.log/warn/error. */
export const log = {
  /** Diagnostic chatter (per-request traces, cache hits). Hidden by default. */
  debug(...args: unknown[]): void {
    if (isEnabled('debug')) currentBackend.debug(...args);
  },
  /** Normal operational output (startup banner, lifecycle events). */
  info(...args: unknown[]): void {
    if (isEnabled('info')) currentBackend.info(...args);
  },
  /** Recoverable problems worth surfacing. */
  warn(...args: unknown[]): void {
    if (isEnabled('warn')) currentBackend.warn(...args);
  },
  /** Errors. Only silenced by the `silent` level. */
  error(...args: unknown[]): void {
    if (isEnabled('error')) currentBackend.error(...args);
  },
};
