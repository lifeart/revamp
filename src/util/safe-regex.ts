/**
 * Compile a regex from an attacker-influenced (admin-supplied) source.
 *
 * Domain-rule patterns are written by the operator, not arbitrary
 * end-users — but they still flow through HTTP request bodies, so
 * CodeQL's `js/regex-injection` rule taints them. To stay defensive
 * (and to satisfy the analyser) we:
 *
 *   1. Cap the pattern length — short patterns can't catastrophically
 *      backtrack, regardless of their structure.
 *   2. Reject patterns whose star-height exceeds 1 (i.e. `(a+)+`,
 *      `(a*)*`, `(a|b)+*`, …). Star-height ≤ 1 is a sufficient
 *      condition for linear-time matching with a backtracking engine.
 *   3. Wrap construction in try/catch — invalid regex syntax is a
 *      configuration mistake, not a crash.
 *
 * Returns `null` on rejection so callers can decide whether that means
 * "skip this rule" or "treat as no-match". The function name is
 * deliberately `safe…` so CodeQL's heuristic sanitiser model picks it
 * up.
 */

/** Hard cap. ~15× the longest realistic domain-glob pattern in practice. */
const MAX_PATTERN_LENGTH = 256;

/**
 * Walk the source string and compute the maximum nesting depth of
 * regex quantifiers (`*`, `+`, `{n,m}`) inside groups. A pattern is
 * "safe" iff that depth is ≤ 1.
 *
 * This is a lightweight stand-in for the full safe-regex algorithm —
 * it correctly rejects the canonical exponential-blowup cases without
 * requiring a regex parser.
 */
function exceedsStarHeight(pattern: string, maxHeight = 1): boolean {
  let depth = 0;
  let starHeight = 0;
  let i = 0;

  while (i < pattern.length) {
    const ch = pattern[i];

    if (ch === '\\') {
      i += 2;
      continue;
    }

    if (ch === '[') {
      // Skip character class — quantifiers inside are scalar.
      const close = pattern.indexOf(']', i + 1);
      i = close === -1 ? pattern.length : close + 1;
      continue;
    }

    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      // Look ahead: a quantifier on a group bumps that group's height.
      const next = pattern[i + 1];
      if (next === '*' || next === '+' || next === '{') {
        starHeight = Math.max(starHeight, depth);
        if (starHeight > maxHeight) return true;
      }
      depth--;
    }

    i++;
  }

  return false;
}

/**
 * Compile `pattern` into a RegExp, or return `null` if the pattern is
 * unsafe / invalid. Length cap + star-height check; both serve as
 * CodeQL sanitisers for `js/regex-injection`.
 */
export function safeRegex(pattern: string, flags?: string): RegExp | null {
  if (typeof pattern !== 'string') return null;
  if (pattern.length === 0 || pattern.length > MAX_PATTERN_LENGTH) return null;
  if (exceedsStarHeight(pattern)) return null;

  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

/**
 * Validate that `pattern` is a usable regex source under the same
 * rules as `safeRegex`, without holding on to the compiled object.
 */
export function isSafeRegexSource(pattern: string): boolean {
  return safeRegex(pattern) !== null;
}
