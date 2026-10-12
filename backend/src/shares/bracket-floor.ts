/**
 * True when a deck's `gradeBracketSignature` says its bracket Estimate was made
 * before the combo match answered, so it is only a floor. The combo segment is
 * the '?' second to last (only the target follows it); mirrors
 * `frontend/src/lib/deck-analysis/bracket-signature.ts`. The signature itself is
 * owner-private and never leaves the backend; only this boolean does.
 */
export function signatureMissesCombos(signature: unknown): boolean {
  return typeof signature === 'string' && signature.split('|').at(-2) === '?';
}
