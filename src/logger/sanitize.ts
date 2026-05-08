/**
 * Strip CR/LF/control characters from a string before passing it to
 * `console.warn|error|log`. Closes the "log injection" attack class
 * where attacker-controlled values (client IP from headers, plugin id,
 * SNI hostname, error messages) could inject fake log lines.
 */
export function sanitizeForLog(value: unknown): string {
  if (value === undefined || value === null) return '';
  const str = typeof value === 'string' ? value : String(value);
  // Drop CR / LF / NUL / other C0 control chars; cap length so an attacker
  // can't bloat the log with megabyte-long strings.
  // eslint-disable-next-line no-control-regex
  const cleaned = str.replace(/[\x00-\x1f\x7f]/g, '?');
  return cleaned.length > 512 ? cleaned.slice(0, 512) + '…' : cleaned;
}
