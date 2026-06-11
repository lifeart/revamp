/**
 * User-Agent Spoofing
 *
 * Shared spoofed User-Agent string and the header-mutating helper. Kept in
 * its own module (it is neither CORS nor compression) so both proxy stacks
 * and the transform pipeline can import it without pulling anything else in.
 *
 * @module proxy/user-agent
 */

import { getConfig, type RevampConfig } from '../config/index.js';

/**
 * Spoof user agent header if enabled in config
 */
export const SPOOFED_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Apply user agent spoofing if enabled
 */
export function spoofUserAgent(headers: Record<string, string | string[] | undefined>, config?: RevampConfig): void {
  const effectiveConfig = config || getConfig();
  if (effectiveConfig.spoofUserAgent && headers['user-agent']) {
    headers['user-agent'] = SPOOFED_USER_AGENT;
  }
}
