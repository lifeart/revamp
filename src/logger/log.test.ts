import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  log,
  setLogLevel,
  getLogLevel,
  setLoggerBackend,
  consoleLoggerBackend,
  isLogLevel,
  LOG_LEVELS,
  type LoggerBackend,
} from './log.js';

describe('logger', () => {
  beforeEach(() => {
    setLogLevel('info');
    setLoggerBackend(consoleLoggerBackend);
  });

  afterEach(() => {
    setLogLevel('info');
    setLoggerBackend(consoleLoggerBackend);
    vi.restoreAllMocks();
  });

  describe('write-through defaults', () => {
    it('routes info to console.log, warn to console.warn, error to console.error', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      log.info('hello %s', 'world');
      log.warn('careful');
      log.error('boom');

      expect(logSpy).toHaveBeenCalledWith('hello %s', 'world');
      expect(warnSpy).toHaveBeenCalledWith('careful');
      expect(errorSpy).toHaveBeenCalledWith('boom');
    });

    it('routes debug to console.log when the debug level is enabled', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      setLogLevel('debug');

      log.debug('trace %d', 42);

      expect(logSpy).toHaveBeenCalledWith('trace %d', 42);
    });

    it('hits console spies installed after the logger module loaded', () => {
      // The default backend must look console methods up at call time, not
      // capture them at import — otherwise test spies would be bypassed.
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      log.warn('spied');
      expect(warnSpy).toHaveBeenCalledWith('spied');
    });
  });

  describe('level filtering', () => {
    it('defaults to info and suppresses debug', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      expect(getLogLevel()).toBe('info');
      log.debug('hidden');
      expect(logSpy).not.toHaveBeenCalled();

      log.info('shown');
      expect(logSpy).toHaveBeenCalledTimes(1);
    });

    it('warn level suppresses debug and info but passes warn and error', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      setLogLevel('warn');

      log.debug('hidden');
      log.info('hidden');
      log.warn('shown');
      log.error('shown');

      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('error level suppresses everything below error', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      setLogLevel('error');

      log.warn('hidden');
      log.error('shown');

      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('silent suppresses all output including errors', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      setLogLevel('silent');

      log.debug('hidden');
      log.info('hidden');
      log.warn('hidden');
      log.error('hidden');

      expect(logSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it('getLogLevel reflects setLogLevel', () => {
      for (const level of LOG_LEVELS) {
        setLogLevel(level);
        expect(getLogLevel()).toBe(level);
      }
    });

    it('setLogLevel throws on unrecognized levels', () => {
      expect(() => setLogLevel('verbose' as never)).toThrow(/Invalid log level/);
      expect(getLogLevel()).toBe('info');
    });
  });

  describe('backend swap', () => {
    function collectingBackend(): { backend: LoggerBackend; calls: Array<[string, unknown[]]> } {
      const calls: Array<[string, unknown[]]> = [];
      return {
        calls,
        backend: {
          debug: (...args) => calls.push(['debug', args]),
          info: (...args) => calls.push(['info', args]),
          warn: (...args) => calls.push(['warn', args]),
          error: (...args) => calls.push(['error', args]),
        },
      };
    }

    it('routes output to a custom backend instead of the console', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const { backend, calls } = collectingBackend();
      setLoggerBackend(backend);

      log.info('custom %s', 'sink');

      expect(calls).toEqual([['info', ['custom %s', 'sink']]]);
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('still applies level filtering before the custom backend', () => {
      const { backend, calls } = collectingBackend();
      setLoggerBackend(backend);
      setLogLevel('error');

      log.debug('hidden');
      log.info('hidden');
      log.warn('hidden');
      log.error('kept');

      expect(calls).toEqual([['error', ['kept']]]);
    });

    it('restores console write-through via consoleLoggerBackend', () => {
      const { backend } = collectingBackend();
      setLoggerBackend(backend);
      setLoggerBackend(consoleLoggerBackend);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      log.warn('back to console');
      expect(warnSpy).toHaveBeenCalledWith('back to console');
    });
  });

  describe('isLogLevel', () => {
    it('accepts every known level', () => {
      for (const level of LOG_LEVELS) {
        expect(isLogLevel(level)).toBe(true);
      }
    });

    it('rejects unknown values', () => {
      expect(isLogLevel('verbose')).toBe(false);
      expect(isLogLevel('')).toBe(false);
      expect(isLogLevel(undefined)).toBe(false);
      expect(isLogLevel(3)).toBe(false);
    });
  });
});
