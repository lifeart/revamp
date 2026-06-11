import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCliConfig, buildHelpText, CLI_OPTIONS, type CliParseResult } from './cli.js';
import { defaultConfig } from './index.js';

function expectConfig(result: CliParseResult): Extract<CliParseResult, { kind: 'config' }> {
  expect(result.kind).toBe('config');
  return result as Extract<CliParseResult, { kind: 'config' }>;
}

function expectError(result: CliParseResult): Extract<CliParseResult, { kind: 'error' }> {
  expect(result.kind).toBe('error');
  return result as Extract<CliParseResult, { kind: 'error' }>;
}

describe('parseCliConfig', () => {
  it('returns empty overrides with no args and no env', () => {
    const result = expectConfig(parseCliConfig([], {}));
    expect(result.overrides).toEqual({});
  });

  it('parses port flags as numbers', () => {
    const result = expectConfig(
      parseCliConfig(
        ['--socks5-port', '1234', '--http-proxy-port', '9090', '--captive-portal-port', '9999'],
        {}
      )
    );
    expect(result.overrides).toEqual({
      socks5Port: 1234,
      httpProxyPort: 9090,
      captivePortalPort: 9999,
    });
  });

  it('parses string flags', () => {
    const result = expectConfig(
      parseCliConfig(
        ['--bind-address', '127.0.0.1', '--cache-dir', '/tmp/rv-cache', '--cert-dir', '/tmp/rv-certs'],
        {}
      )
    );
    expect(result.overrides).toEqual({
      bindAddress: '127.0.0.1',
      cacheDir: '/tmp/rv-cache',
      certDir: '/tmp/rv-certs',
    });
  });

  it('parses boolean flags including no- negation', () => {
    const result = expectConfig(
      parseCliConfig(['--remove-ads', '--no-transform-js', '--no-cache-enabled'], {})
    );
    expect(result.overrides).toEqual({
      removeAds: true,
      transformJs: false,
      cacheEnabled: false,
    });
  });

  it('rejects conflicting boolean flags', () => {
    const result = expectError(parseCliConfig(['--remove-ads', '--no-remove-ads'], {}));
    expect(result.message).toContain('--remove-ads');
    expect(result.message).toContain('--no-remove-ads');
  });

  it('reads REVAMP_* environment variables', () => {
    const result = expectConfig(
      parseCliConfig([], {
        REVAMP_SOCKS5_PORT: '2345',
        REVAMP_BIND_ADDRESS: '127.0.0.1',
        REVAMP_REMOVE_ADS: 'false',
        REVAMP_TRANSFORM_JS: '1',
      })
    );
    expect(result.overrides).toEqual({
      socks5Port: 2345,
      bindAddress: '127.0.0.1',
      removeAds: false,
      transformJs: true,
    });
  });

  it('gives CLI flags precedence over env vars', () => {
    const result = expectConfig(
      parseCliConfig(['--socks5-port', '2222', '--no-remove-ads'], {
        REVAMP_SOCKS5_PORT: '1111',
        REVAMP_REMOVE_ADS: 'true',
      })
    );
    expect(result.overrides.socks5Port).toBe(2222);
    expect(result.overrides.removeAds).toBe(false);
  });

  it('ignores unrelated environment variables', () => {
    const result = expectConfig(parseCliConfig([], { PATH: '/usr/bin', HOME: '/root' }));
    expect(result.overrides).toEqual({});
  });

  it('rejects non-numeric port values', () => {
    const result = expectError(parseCliConfig(['--socks5-port', 'abc'], {}));
    expect(result.message).toContain('--socks5-port');
    expect(result.message).toContain('abc');
  });

  it('rejects out-of-range port values', () => {
    expectError(parseCliConfig(['--http-proxy-port', '70000'], {}));
    expectError(parseCliConfig(['--http-proxy-port', '0'], {}));
    expectError(parseCliConfig(['--http-proxy-port', '8080.5'], {}));
  });

  it('rejects invalid port env values and names the variable', () => {
    const result = expectError(parseCliConfig([], { REVAMP_HTTP_PROXY_PORT: 'nope' }));
    expect(result.message).toContain('REVAMP_HTTP_PROXY_PORT');
  });

  it('rejects invalid boolean env values', () => {
    const result = expectError(parseCliConfig([], { REVAMP_REMOVE_ADS: 'maybe' }));
    expect(result.message).toContain('REVAMP_REMOVE_ADS');
    expect(result.message).toContain('true/false/1/0');
  });

  it('parses --log-level values case-insensitively', () => {
    const result = expectConfig(parseCliConfig(['--log-level', 'DEBUG'], {}));
    expect(result.overrides).toEqual({ logLevel: 'debug' });
  });

  it('reads REVAMP_LOG_LEVEL and lets --log-level override it', () => {
    const fromEnv = expectConfig(parseCliConfig([], { REVAMP_LOG_LEVEL: 'silent' }));
    expect(fromEnv.overrides).toEqual({ logLevel: 'silent' });

    const overridden = expectConfig(
      parseCliConfig(['--log-level', 'warn'], { REVAMP_LOG_LEVEL: 'silent' })
    );
    expect(overridden.overrides).toEqual({ logLevel: 'warn' });
  });

  it('rejects unknown log levels and lists the valid ones', () => {
    const result = expectError(parseCliConfig(['--log-level', 'verbose'], {}));
    expect(result.message).toContain('--log-level');
    expect(result.message).toContain('debug, info, warn, error, silent');
  });

  it('rejects unknown flags', () => {
    const result = expectError(parseCliConfig(['--bogus-flag'], {}));
    expect(result.message).toContain('--bogus-flag');
  });

  it('rejects positional arguments', () => {
    expectError(parseCliConfig(['start'], {}));
  });

  it('treats empty env values as unset', () => {
    const result = expectConfig(parseCliConfig([], { REVAMP_CACHE_DIR: '' }));
    expect(result.overrides).toEqual({});
  });

  it('rejects empty CLI flag values', () => {
    const result = expectError(parseCliConfig(['--cache-dir', ''], {}));
    expect(result.message).toContain('--cache-dir');
  });

  it('returns help text for --help', () => {
    const result = parseCliConfig(['--help'], {});
    expect(result.kind).toBe('help');
  });

  it('returns the package.json version for --version', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')
    ) as { version: string };
    const result = parseCliConfig(['--version'], {});
    expect(result.kind).toBe('version');
    expect((result as Extract<CliParseResult, { kind: 'version' }>).text).toBe(pkg.version);
  });
});

describe('buildHelpText', () => {
  it('lists every flag with its default and env var', () => {
    const help = buildHelpText();
    for (const opt of CLI_OPTIONS) {
      expect(help).toContain(opt.flag);
      expect(help).toContain(opt.env);
      expect(help).toContain(`default: ${String(defaultConfig[opt.key])}`);
    }
    expect(help).toContain('--help');
    expect(help).toContain('--version');
    expect(help).toContain('Precedence: CLI flag > environment variable > built-in default.');
  });
});

describe('CLI_OPTIONS', () => {
  it('uses kebab-case flags and REVAMP_-prefixed env vars', () => {
    for (const opt of CLI_OPTIONS) {
      expect(opt.flag).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(opt.env).toMatch(/^REVAMP_[A-Z0-9_]+$/);
    }
  });

  it('has no duplicate flags, env vars, or config keys', () => {
    const flags = CLI_OPTIONS.map((o) => o.flag);
    const envs = CLI_OPTIONS.map((o) => o.env);
    const keys = CLI_OPTIONS.map((o) => o.key);
    expect(new Set(flags).size).toBe(flags.length);
    expect(new Set(envs).size).toBe(envs.length);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
