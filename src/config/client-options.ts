/**
 * Client Config Options Metadata
 *
 * Single source of truth for all client-configurable options.
 * This file defines the options once, and other parts of the codebase
 * can derive their behavior from this metadata.
 */

/**
 * Metadata for a single config option
 */
export interface ConfigOptionMeta {
  /** Config key name (e.g., 'transformJs') */
  key: string;
  /** Display label for UI */
  label: string;
  /** Short description for tooltips/help text */
  description: string;
  /** Default value */
  defaultValue: boolean;
  /** Category for grouping in UI */
  category: 'transformation' | 'privacy' | 'compatibility' | 'cache';
  /** Emoji icon for the category */
  icon?: string;
}

/**
 * All client-configurable options with their metadata.
 * This is the SINGLE SOURCE OF TRUTH for config option definitions.
 */
export const CLIENT_CONFIG_OPTIONS: readonly ConfigOptionMeta[] = [
  // Transformation options
  {
    key: 'transformJs',
    label: 'Transform JavaScript',
    description: 'Convert modern JS to Safari 9 compatible code',
    defaultValue: true,
    category: 'transformation',
  },
  {
    key: 'transformCss',
    label: 'Transform CSS',
    description: 'Convert modern CSS features for older browsers',
    defaultValue: true,
    category: 'transformation',
  },
  {
    key: 'transformHtml',
    label: 'Transform HTML',
    description: 'Process and modify HTML structure',
    defaultValue: true,
    category: 'transformation',
  },
  {
    key: 'bundleEsModules',
    label: 'Bundle ES Modules',
    description: 'Bundle ES modules for legacy browsers using esbuild',
    defaultValue: true,
    category: 'transformation',
  },
  {
    key: 'emulateServiceWorkers',
    label: 'Emulate Service Workers',
    description: 'Transform and bridge Service Workers for legacy browsers',
    defaultValue: true,
    category: 'compatibility',
  },

  // Privacy options
  {
    key: 'removeAds',
    label: 'Remove Ads',
    description: 'Block ad domains and remove ad elements',
    defaultValue: true,
    category: 'privacy',
  },
  {
    key: 'removeTracking',
    label: 'Remove Tracking',
    description: 'Block tracking scripts and pixels',
    defaultValue: true,
    category: 'privacy',
  },

  // Compatibility options
  {
    key: 'injectPolyfills',
    label: 'Inject Polyfills',
    description: 'Add missing browser features (Promise, fetch, etc.)',
    defaultValue: true,
    category: 'compatibility',
  },
  {
    key: 'spoofUserAgent',
    label: 'Spoof User-Agent (HTTP)',
    description: 'Send modern browser headers to servers',
    defaultValue: true,
    category: 'compatibility',
  },
  {
    key: 'spoofUserAgentInJs',
    label: 'Spoof User-Agent (JS)',
    description: 'Override navigator.userAgent in JavaScript',
    defaultValue: true,
    category: 'compatibility',
  },

  // Cache options
  {
    key: 'cacheEnabled',
    label: 'Enable Cache',
    description: 'Cache transformed content for faster loading',
    defaultValue: true,
    category: 'cache',
  },
] as const;

/**
 * Category metadata for UI grouping
 */
export const CONFIG_CATEGORIES = {
  transformation: { title: 'Transformation', icon: '🔧' },
  privacy: { title: 'Privacy', icon: '🛡️' },
  compatibility: { title: 'Polyfills & Compatibility', icon: '🔌' },
  cache: { title: 'Cache', icon: '💾' },
} as const;

/**
 * Type for client config keys (derived from OPTIONS)
 */
export type ClientConfigKey = (typeof CLIENT_CONFIG_OPTIONS)[number]['key'];

/**
 * Get all config keys as an array
 */
export function getClientConfigKeys(): string[] {
  return CLIENT_CONFIG_OPTIONS.map((opt) => opt.key);
}

/**
 * Get default values as an object
 */
export function getClientConfigDefaults(): Record<string, boolean> {
  const defaults: Record<string, boolean> = {};
  for (const opt of CLIENT_CONFIG_OPTIONS) {
    defaults[opt.key] = opt.defaultValue;
  }
  return defaults;
}

/**
 * Get options grouped by category
 */
export function getOptionsByCategory(): Record<string, ConfigOptionMeta[]> {
  const grouped: Record<string, ConfigOptionMeta[]> = {};
  for (const opt of CLIENT_CONFIG_OPTIONS) {
    if (!grouped[opt.category]) {
      grouped[opt.category] = [];
    }
    grouped[opt.category].push(opt);
  }
  return grouped;
}

/**
 * Generate the defaultConfig object for config-overlay.ts (JavaScript string)
 */
export function generateOverlayDefaultConfig(): string {
  const lines = CLIENT_CONFIG_OPTIONS.map((opt) => `    ${opt.key}: ${opt.defaultValue}`);
  return `{\n${lines.join(',\n')}\n  }`;
}

/**
 * Generate the mappings object for config-overlay.ts (JavaScript string)
 */
export function generateOverlayMappings(): string {
  const lines = CLIENT_CONFIG_OPTIONS.map((opt) => `      'revamp-opt-${opt.key}': '${opt.key}'`);
  return `{\n${lines.join(',\n')}\n    }`;
}

/**
 * Generate the getConfigFromUI function body for config-overlay.ts (JavaScript string)
 */
export function generateOverlayGetConfigFromUI(): string {
  const lines = CLIENT_CONFIG_OPTIONS.map(
    (opt) => `      ${opt.key}: document.getElementById('revamp-opt-${opt.key}').checked`
  );
  return `{\n${lines.join(',\n')}\n    }`;
}

/**
 * Generate the overlay section HTML for a category (JavaScript string for concatenation)
 */
function generateOverlaySectionOptions(category: keyof typeof CONFIG_CATEGORIES): string {
  const options = CLIENT_CONFIG_OPTIONS.filter((opt) => opt.category === category);
  return options
    .map(
      (opt) =>
        `createOption('revamp-opt-${opt.key}', '${opt.label}',\n` +
        `            '${opt.description}', currentConfig.${opt.key})`
    )
    .join(' +\n          ');
}

/**
 * Generate all overlay sections HTML (JavaScript string for concatenation)
 */
export function generateOverlaySections(): string {
  const categoryOrder: (keyof typeof CONFIG_CATEGORIES)[] = [
    'transformation',
    'privacy',
    'compatibility',
    'cache',
  ];

  return categoryOrder
    .map((cat) => {
      const { title, icon } = CONFIG_CATEGORIES[cat];
      const optionsCode = generateOverlaySectionOptions(cat);
      return (
        `'<div class="revamp-config-section">' +\n` +
        `          '<div class="revamp-config-section-title">${icon} ${title}</div>' +\n` +
        `          ${optionsCode} +\n` +
        `        '</div>'`
      );
    })
    .join(' +\n        ');
}
