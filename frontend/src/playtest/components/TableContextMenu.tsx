import { CtxMenuShell } from './CtxMenuShell';

export interface TableMenuItem {
  label: string;
  /** Shown right-aligned in a `<kbd>`; the key itself is bound in PlaytestBoard. */
  shortcut?: string;
  onClick(): void;
  disabled?: boolean;
}

interface Props {
  x: number;
  y: number;
  variant: 'floating' | 'sheet';
  items: TableMenuItem[];
  onClose(): void;
}

/**
 * The table's own menu: right-click (or the Context Menu key / Shift+F10, or
 * a touch long-press) on bare felt. Same `CtxMenuShell` chrome every card
 * menu uses, so Escape, the backdrop, the clamp into the safe viewport and
 * the initial focus are all the shared ones. Items name their key binding —
 * this menu is where the board's shortcuts are discovered.
 */
export function TableContextMenu({ x, y, variant, items, onClose }: Props) {
  return (
    <CtxMenuShell x={x} y={y} title="Table actions" variant={variant} onClose={onClose}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className="playtest-ctx-action playtest-ctx-action--table"
          disabled={item.disabled}
          onClick={() => {
            onClose();
            item.onClick();
          }}
        >
          <span>{item.label}</span>
          {item.shortcut && <kbd>{item.shortcut}</kbd>}
        </button>
      ))}
    </CtxMenuShell>
  );
}
