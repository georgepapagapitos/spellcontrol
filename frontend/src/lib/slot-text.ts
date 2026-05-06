/**
 * Formatting helpers for the tiny card-name labels rendered inside binder
 * pocket slots. The slots are too small for arbitrary names, so we pre-trim
 * any single word that wouldn't fit on one line and let CSS handle the
 * multi-word wrapping at spaces.
 */

/** Max characters per word that fits one line of the 9-pocket slot at default font-size. */
export const MAX_WORD_CHARS = 11;

/**
 * Replace any word longer than `maxLen` with a truncated form ending in an
 * ellipsis. Whitespace between words is preserved, so the output still wraps
 * naturally at spaces in CSS.
 */
export function truncateLongWords(name: string, maxLen: number = MAX_WORD_CHARS): string {
  return name
    .split(/(\s+)/)
    .map((part) => (part.length > maxLen ? part.slice(0, maxLen - 1) + '…' : part))
    .join('');
}
