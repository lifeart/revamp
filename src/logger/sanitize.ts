/**
 * Sanitize an attacker-controllable value before passing it to a logger.
 *
 * Uses `JSON.stringify` so that:
 *   1. CR / LF / NUL / other C0 control characters are encoded (`\n` etc.)
 *      rather than emitted literally — this closes the "log injection"
 *      attack class (CWE-117) where attacker-controlled values fake
 *      additional log lines.
 *   2. CodeQL recognises `JSON.stringify` as a known sanitiser for the
 *      `js/log-injection` and `js/tainted-format-string` queries, so
 *      taint analysis at every call site clears cleanly.
 *
 * The wrapping quotes are intentional — they make the boundary of the
 * untrusted value visible in logs.
 */
export function sanitizeForLog(value: unknown): string {
  if (value === undefined || value === null) return '""';
  const str = typeof value === 'string' ? value : String(value);
  const truncated = str.length > 512 ? str.slice(0, 512) + '…' : str;
  return JSON.stringify(truncated);
}
