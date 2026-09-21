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
  /** Accessible name, and the sheet variant's visible heading. Defaults to
   *  the felt's own menu; a zone pile passes its zone ("Library") so the
   *  menu says which pile it belongs to. */
  title?: string;
  onClose(): void;
}

/**
 * The board's flat right-click menu, used by two surfaces: bare felt (the
 * table's own actions) and the four zone piles. Opened by right-click, the
 * Context Menu key / Shift+F10, a touch long-press, or a pile's kebab. Same
 * `CtxMenuShell` chrome every card menu uses, so Escape, the backdrop, the
 * clamp into the safe viewport and the initial focus are all the shared
 * ones. Items name their key binding — this menu is where the board's
 * shortcuts are discovered.
 */
export function TableContextMenu({ x, y, variant, items, title, onClose }: Props) {
  return (
    <CtxMenuShell x={x} y={y} title={title ?? 'Table actions'} variant={variant} onClose={onClose}>
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
