/**
 * Keeps keyboard focus in the list when a row is removed from under it (a
 * suggestion hidden with "Not for this deck"): the row's menu returns focus to a
 * trigger that is about to unmount, which would drop focus to the page. After the
 * removal commits, focus goes to the next row's `targetSelector` (else the
 * previous row's), unless focus has already landed somewhere real.
 */
export function focusNeighborAfterRemoval(
  row: HTMLElement | null,
  rowSelector: string,
  targetSelector: string
): void {
  if (!row || typeof document === 'undefined') return;
  const host = row.closest('li') ?? row;
  const list = host.closest('ul, ol') ?? host.parentElement;
  if (!list) return;
  const rows = [...list.querySelectorAll<HTMLElement>(rowSelector)].filter(
    (r) => !host.contains(r)
  );
  const after = rows.find(
    (r) => host.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING
  );
  const neighbor = after ?? rows[rows.length - 1];
  if (!neighbor) return;
  const target = neighbor.querySelector<HTMLElement>(targetSelector);
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active && active !== document.body && document.contains(active)) return;
    target?.focus({ preventScroll: true });
  });
}
