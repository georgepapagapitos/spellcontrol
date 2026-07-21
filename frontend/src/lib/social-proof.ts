import { formatCount } from './format-count';

/** Below this, a view/copy count reads as noise on a brand-new publish
 *  rather than social proof — see the ghost-town-proofing rationale reused
 *  from the profile/shared-deck pages' own inline threshold checks. */
export const MIN_PUBLIC_COUNT = 5;

/**
 * Gate + format a public view/copy count. Formatting itself (k-suffix
 * rounding) is entirely delegated to `formatCount` — this is only the
 * threshold: `null` below `MIN_PUBLIC_COUNT` (caller renders nothing).
 */
export function formatSocialCount(n: number): string | null {
  if (n < MIN_PUBLIC_COUNT) return null;
  return formatCount(n);
}
