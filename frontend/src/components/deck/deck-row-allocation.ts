import type { Row } from './deck-display-rows';

// Plain-language description of how this row's slots map to owned copies.
// Used as the screen-reader label and hover title for the qty pill, so the
// allocation truth is conveyed even when no warning glyph is shown.
export function allocationSummary(row: Row): string {
  const missing = row.unownedQty + row.orphanQty + row.claimedElsewhereQty;
  const proxies = row.proxyQty === 1 ? '1 proxy' : `${row.proxyQty} proxies`;
  if (missing === 0) {
    if (row.proxyQty === row.qty)
      return row.qty === 1 ? 'Played as a proxy' : `All ${row.qty} played as proxies`;
    if (row.proxyQty > 0)
      return `${row.allocatedQty} of ${row.qty} from your collection, ${proxies}`;
    return row.qty === 1 ? 'From your collection' : `All ${row.qty} copies from your collection`;
  }
  if (row.allocatedQty === 0 && row.proxyQty === 0) {
    if (row.orphanQty > 0)
      return 'The collection copy this slot was assigned to is no longer present';
    if (row.releasedQty > 0 && row.releasedQty === row.unownedQty)
      return row.qty === 1
        ? 'Copy released from this deck'
        : `${row.releasedQty} of ${row.qty} copies released from this deck`;
    if (row.unownedQty > 0) return 'Not in your collection';
    return row.claimedBy
      ? `Owned, but currently in ${row.claimedBy.ownerKind === 'cube' ? 'cube' : 'deck'}: ${row.claimedBy.ownerName}`
      : 'Owned, but currently in another deck';
  }
  const parts: string[] = [];
  if (row.claimedElsewhereQty > 0) parts.push(`${row.claimedElsewhereQty} in another deck`);
  if (row.orphanQty > 0) parts.push(`${row.orphanQty} no longer in collection`);
  if (row.releasedQty > 0) parts.push(`${row.releasedQty} released`);
  const notOwned = row.unownedQty - row.releasedQty;
  if (notOwned > 0) parts.push(`${notOwned} not in collection`);
  if (row.proxyQty > 0) parts.push(proxies);
  const note = parts.length > 0 ? ` (${parts.join('; ')})` : '';
  return `${row.allocatedQty} of ${row.qty} from your collection${note}`;
}

export function allocationAriaLabel(row: Row, opts: { editable: boolean }): string {
  const base = `${row.qty} in deck`;
  const detail = allocationSummary(row);
  const tail = opts.editable ? ', click to change quantity' : '';
  return `${base}: ${detail}${tail}`;
}

export function allocationTitle(row: Row, opts: { editable: boolean }): string {
  const detail = allocationSummary(row);
  if (!opts.editable) return detail;
  return `${detail}, click to change quantity`;
}
