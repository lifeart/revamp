/**
 * CLI argument and environment variable parsing for the Revamp entry point.
 *
 * Every option maps to a RevampConfig field. Precedence:
 *   CLI flag > REVAMP_* environment variable > built-in default.
 */

import { parseArgs, type ParseArgsConfig } from 'node:util';
import { readFileSync } from 'node:fs';
import { defaultConfig, type RevampConfig } from './index.js';
import { isLogLevel, LOG_LEVELS } from '../logger/log.js';

export type CliOptionType = 'port' | 'string' | 'boolean' | 'logLevel';

export interface CliOption {
  /** RevampConfig field this option overrides */
  key: keyof RevampConfig;
  /** kebab-case flag name (without leading --) */
  flag: string;
  /** REVAMP_* environment variable name */
  env: string;
  type: CliOptionType;
  description: string;
}

export const CLI_OPTIONS: readonly CliOption[] = [
  // Server settings
  { key: 'socks5Port', flag: 'socks5-port', env: 'REVAMP_SOCKS5_PORT', type: 'port', description: 'SOCKS5 proxy port' },
  { key: 'httpProxyPort', flag: 'http-proxy-port', env: 'REVAMP_HTTP_PROXY_PORT', type: 'port', description: 'HTTP proxy port' },
  { key: 'captivePortalPort', flag: 'captive-portal-port', env: 'REVAMP_CAPTIVE_PORTAL_PORT', type: 'port', description: 'Captive portal (certificate download) port' },
  { key: 'bindAddress', flag: 'bind-address', env: 'REVAMP_BIND_ADDRESS', type: 'string', description: 'Bind address (0.0.0.0 for LAN, 127.0.0.1 for localhost only)' },
  // Directories
  { key: 'cacheDir', flag: 'cache-dir', env: 'REVAMP_CACHE_DIR', type: 'string', description: 'Cache directory' },
  { key: 'certDir', flag: 'cert-dir', env: 'REVAMP_CERT_DIR', type: 'string', description: 'Certificate directory' },
  // Feature toggles
  { key: 'transformJs', flag: 'transform-js', env: 'REVAMP_TRANSFORM_JS', type: 'boolean', description: 'Transpile JavaScript for legacy browsers' },
  { key: 'transformCss', flag: 'transform-css', env: 'REVAMP_TRANSFORM_CSS', type: 'boolean', description: 'Transform CSS for legacy browsers' },
  { key: 'transformHtml', flag: 'transform-html', env: 'REVAMP_TRANSFORM_HTML', type: 'boolean', description: 'Transform HTML and inject polyfill hooks' },
  { key: 'bundleEsModules', flag: 'bundle-es-modules', env: 'REVAMP_BUNDLE_ES_MODULES', type: 'boolean', description: 'Bundle ES modules for legacy browsers' },
  { key: 'emulateServiceWorkers', flag: 'emulate-service-workers', env: 'REVAMP_EMULATE_SERVICE_WORKERS', type: 'boolean', description: 'Transform and bridge Service Workers' },
  { key: 'remoteServiceWorkers', flag: 'remote-service-workers', env: 'REVAMP_REMOTE_SERVICE_WORKERS', type: 'boolean', description: 'Execute Service Workers remotely (requires Playwright)' },
  { key: 'removeAds', flag: 'remove-ads', env: 'REVAMP_REMOVE_ADS', type: 'boolean', description: 'Block ad domains' },
  { key: 'removeTracking', flag: 'remove-tracking', env: 'REVAMP_REMOVE_TRACKING', type: 'boolean', description: 'Block tracking domains' },
  { key: 'injectPolyfills', flag: 'inject-polyfills', env: 'REVAMP_INJECT_POLYFILLS', type: 'boolean', description: 'Inject polyfills for missing APIs' },
  { key: 'spoofUserAgent', flag: 'spoof-user-agent', env: 'REVAMP_SPOOF_USER_AGENT', type: 'boolean', description: 'Send a modern User-Agent to servers' },
  { key: 'spoofUserAgentInJs', flag: 'spoof-user-agent-in-js', env: 'REVAMP_SPOOF_USER_AGENT_IN_JS', type: 'boolean', description: 'Override navigator.userAgent in JavaScript' },
  { key: 'cacheEnabled', flag: 'cache-enabled', env: 'REVAMP_CACHE_ENABLED', type: 'boolean', description: 'Enable response caching' },
  { key: 'logJsonRequests', flag: 'log-json-requests', env: 'REVAMP_LOG_JSON_REQUESTS', type: 'boolean', description: 'Log application/json requests' },
  { key: 'logLevel', flag: 'log-level', env: 'REVAMP_LOG_LEVEL', type: 'logLevel', description: `Log verbosity (${LOG_LEVELS.join('|')})` },
  { key: 'allowInsecureUpstream', flag: 'allow-insecure-upstream', env: 'REVAMP_ALLOW_INSECURE_UPSTREAM', type: 'boolean', description: 'Skip upstream TLS certificate validation (dangerous)' },
];

export type CliParseResult =
  | { kind: 'config'; overrides: Partial<RevampConfig> }
  | { kind: 'help'; text: string }
  | { kind: 'version'; text: string }
  | { kind: 'error'; message: string };

function getVersion(): string {
  const pkg = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')
  ) as { version?: string };
  return pkg.version ?? '0.0.0';
}

/** Parse a single option value; `source` names the flag/env var for error messages. */
function parseOptionValue(
  option: CliOption,
  raw: string,
  source: string
): { value: number | string | boolean } | { error: string } {
  switch (option.type) {
    case 'port': {
      const port = Number(raw);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return { error: `Invalid value "${raw}" for ${source}: expected an integer port between 1 and 65535` };
      }
      return { value: port };
    }
    case 'boolean': {
      const normalized = raw.toLowerCase();
      if (normalized === 'true' || normalized === '1') return { value: true };
      if (normalized === 'false' || normalized === '0') return { value: false };
      return { error: `Invalid value "${raw}" for ${source}: expected true/false/1/0` };
    }
    case 'string': {
      if (raw === '') {
        return { error: `Invalid empty value for ${source}` };
      }
      return { value: raw };
    }
    case 'logLevel': {
      const normalized = raw.toLowerCase();
      if (!isLogLevel(normalized)) {
        return { error: `Invalid value "${raw}" for ${source}: expected one of ${LOG_LEVELS.join(', ')}` };
      }
      return { value: normalized };
    }
  }
}

const FLAG_PLACEHOLDERS: Record<Exclude<CliOptionType, 'boolean'>, string> = {
  port: 'port',
  string: 'value',
  logLevel: 'level',
};

function flagLabel(option: CliOption): string {
  if (option.type === 'boolean') return `--[no-]${option.flag}`;
  return `--${option.flag} <${FLAG_PLACEHOLDERS[option.type]}>`;
}

export function buildHelpText(): string {
  const rows: Array<[string, string]> = CLI_OPTIONS.map((opt) => [
    flagLabel(opt),
    `${opt.description} (default: ${String(defaultConfig[opt.key])}) [env: ${opt.env}]`,
  ]);
  rows.push(['--help', 'Show this help and exit']);
  rows.push(['--version', 'Print the version and exit']);

  const padWidth = Math.max(...rows.map(([label]) => label.length)) + 2;
  const optionLines = rows.map(([label, text]) => `  ${label.padEnd(padWidth)}${text}`);

  return [
    `Revamp v${getVersion()} — Legacy Browser Compatibility Proxy`,
    '',
    'Usage: revamp [options]',
    '',
    'Options:',
    ...optionLines,
    '',
    'Boolean flags can be negated with a no- prefix (e.g. --no-remove-ads).',
    'Every option can also be set via its REVAMP_* environment variable.',
    'Precedence: CLI flag > environment variable > built-in default.',
  ].join('\n');
}

/**
 * Parse CLI arguments and environment variables into config overrides.
 * Pure function (no process.exit / console output) so callers decide
 * how to surface help/version/error results.
 */
export function parseCliConfig(
  argv: readonly string[],
  env: Record<string, string | undefined>
): CliParseResult {
  const options: NonNullable<ParseArgsConfig['options']> = {
    help: { type: 'boolean' },
    version: { type: 'boolean' },
  };
  for (const opt of CLI_OPTIONS) {
    if (opt.type === 'boolean') {
      options[opt.flag] = { type: 'boolean' };
      options[`no-${opt.flag}`] = { type: 'boolean' };
    } else {
      options[opt.flag] = { type: 'string' };
    }
  }

  let values: Record<string, string | boolean | (string | boolean)[] | undefined>;
  try {
    ({ values } = parseArgs({ args: [...argv], options, strict: true, allowPositionals: false }));
  } catch (err) {
    // parseArgs throws on unknown flags or missing values — surface as a CLI error
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  }

  if (values.help) {
    return { kind: 'help', text: buildHelpText() };
  }
  if (values.version) {
    return { kind: 'version', text: getVersion() };
  }

  const overrides: Partial<RevampConfig> = {};
  const assign = (key: keyof RevampConfig, value: number | string | boolean): void => {
    (overrides as Record<string, unknown>)[key] = value;
  };

  // Environment variables first, then CLI flags override them.
  // Empty env values are treated as unset.
  for (const opt of CLI_OPTIONS) {
    const envValue = env[opt.env];
    if (envValue === undefined || envValue === '') continue;
    const parsed = parseOptionValue(opt, envValue, `environment variable ${opt.env}`);
    if ('error' in parsed) return { kind: 'error', message: parsed.error };
    assign(opt.key, parsed.value);
  }

  for (const opt of CLI_OPTIONS) {
    if (opt.type === 'boolean') {
      const enabled = values[opt.flag] === true;
      const disabled = values[`no-${opt.flag}`] === true;
      if (enabled && disabled) {
        return { kind: 'error', message: `Conflicting flags --${opt.flag} and --no-${opt.flag}` };
      }
      if (enabled) assign(opt.key, true);
      else if (disabled) assign(opt.key, false);
    } else {
      const raw = values[opt.flag];
      if (typeof raw !== 'string') continue;
      const parsed = parseOptionValue(opt, raw, `--${opt.flag}`);
      if ('error' in parsed) return { kind: 'error', message: parsed.error };
      assign(opt.key, parsed.value);
    }
  }

  return { kind: 'config', overrides };
}
