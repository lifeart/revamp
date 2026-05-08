/**
 * Revamp Plugin System - Internal entry points
 *
 * T37: this module is intentionally NOT re-exported from `src/plugins/index.ts`
 * (the public, npm-exposed `revamp/plugin` surface). It exists so the loader,
 * context, hook executor and tests can reach the singleton `pluginRegistry`
 * without that singleton becoming part of the package's public API graph.
 *
 * A plugin can `import { ... } from 'revamp/plugin'`, but it MUST NOT be able
 * to grab the registry and bypass `HOOK_PERMISSION_REQUIREMENTS` by calling
 * `pluginRegistry.registerHook` directly. Keeping the singleton here, plus
 * the defence-in-depth permission check that `pluginRegistry.registerHook`
 * itself now performs (see `registry.ts`), closes that escape hatch.
 *
 * Anything imported from this module is "trusted-caller" — only Revamp's own
 * runtime code (loader, context wrapper, hook executor) and the in-tree test
 * harness should reach for it.
 */

export { PluginRegistry, pluginRegistry } from './registry.js';
