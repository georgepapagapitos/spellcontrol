/**
 * "Choose fields" beside a sort chain that is already in view (the binder
 * editor's Order section, the desktop sort popover): the chip moves to the
 * chain's first field picker, the control choosing fields starts with. An
 * empty chain has no picker yet, so it lands on "+ Then by", which adds one.
 * It was a no-op there (E506); the phone sheet drills into its own page.
 */
export function focusFirstSortField(root: ParentNode | null): boolean {
  const target =
    root?.querySelector<HTMLElement>('.sort-editor button[aria-haspopup="listbox"]') ??
    root?.querySelector<HTMLElement>('.sort-editor .btn-add-group');
  if (!target) return false;
  target.scrollIntoView?.({ block: 'nearest' });
  target.focus();
  return true;
}
