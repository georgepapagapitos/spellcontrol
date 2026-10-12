/** Signature segment for "the combo match hadn't answered": not the same as no combos. */
export const COMBOS_UNCHECKED = '?';

/**
 * True when a deck's grade/bracket signature says its Estimate was made before
 * the combo match answered, so it is only a floor (a combo can raise it, never
 * lower it). The combo segment is second to last (only the target follows it),
 * and no card or commander name contains '|'. Shared by the deck page's hook
 * and every readout that shows a synced `bracketEstimation` off that page.
 */
export function signatureMissesCombos(signature: string | null | undefined): boolean {
  return signature?.split('|').at(-2) === COMBOS_UNCHECKED;
}
