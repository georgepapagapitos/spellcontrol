import { useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { CtxMenuShell } from './CtxMenuShell';

export interface TableMenuItem {
  label: string;
  /** Shown right-aligned in a `<kbd>`; the key itself is bound in PlaytestBoard. */
  shortcut?: string;
  onClick?(): void;
  disabled?: boolean;
  /** Present makes the row a toggle, and says which way it is set. */
  pressed?: boolean;
  /** Rows this one drills into. A row has this or `onClick`, never both. */
  items?: TableMenuItem[];
  /** A page that is a control rather than a list of rows — the library's
   *  draw-count stepper. Used in place of `items`, and the caller closes the
   *  menu itself when the control is done. */
  content?: ReactNode;
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

/** Walk `path` down the item tree. Returns the open submenu row, or null at
 *  the root. */
function resolve(items: TableMenuItem[], path: number[]): TableMenuItem | null {
  let open: TableMenuItem | null = null;
  let list = items;
  for (const i of path) {
    open = list[i] ?? null;
    if (!open) return null;
    list = open.items ?? [];
  }
  return open;
}

/**
 * The board's right-click menu, used by two surfaces: bare felt (the table's
 * own actions) and the four zone piles. Opened by right-click, the Context
 * Menu key / Shift+F10, a touch long-press, or a pile's kebab. Same
 * `CtxMenuShell` chrome every card menu uses, so Escape, the backdrop, the
 * clamp into the safe viewport and the initial focus are all the shared
 * ones. Items name their key binding — this menu is where the board's
 * shortcuts are discovered.
 *
 * A row with `items` or `content` drills into a page instead of acting, the
 * way `CardContextMenu` does, so a list of destinations doesn't have to be
 * spent as a dozen rows on the root.
 */
export function TableContextMenu({ x, y, variant, items, title, onClose }: Props) {
  const [path, setPath] = useState<number[]>([]);
  const open = resolve(items, path);
  const rows = open ? (open.items ?? []) : items;
  const rootTitle = title ?? 'Table actions';
  // The page one level up, which is what the back row goes to and names.
  const parent = resolve(items, path.slice(0, -1));

  return (
    <CtxMenuShell
      x={x}
      y={y}
      title={open ? open.label : rootTitle}
      variant={variant}
      // A page swap changes the panel's height, so the floating variant
      // re-clamps, and focus lands on the new page's first row.
      contentKey={path.join('.')}
      onClose={onClose}
    >
      {open && (
        <button
          type="button"
          role="menuitem"
          className="playtest-ctx-back"
          onClick={() => setPath(path.slice(0, -1))}
          aria-label={`Back to ${parent ? parent.label : rootTitle}`}
        >
          <ChevronLeft width={14} height={14} aria-hidden />
          <span>{parent ? parent.label : rootTitle}</span>
        </button>
      )}
      {open?.content}
      {rows.map((item, i) =>
        item.items || item.content ? (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className="playtest-ctx-action playtest-ctx-action--table playtest-ctx-action--submenu"
            aria-haspopup="menu"
            disabled={item.disabled}
            onClick={() => setPath([...path, i])}
          >
            <span>{item.label}</span>
            <span className="playtest-ctx-action__end">
              {item.shortcut && <kbd>{item.shortcut}</kbd>}
              <ChevronRight width={14} height={14} aria-hidden />
            </span>
          </button>
        ) : (
          <button
            key={item.label}
            type="button"
            // A toggle inside a menu is a menuitemcheckbox — `menuitem` does
            // not carry a checked state, and `aria-pressed` is a button's
            // idiom, not a menu's.
            role={item.pressed === undefined ? 'menuitem' : 'menuitemcheckbox'}
            aria-checked={item.pressed}
            className="playtest-ctx-action playtest-ctx-action--table"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onClick?.();
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && <kbd>{item.shortcut}</kbd>}
          </button>
        )
      )}
    </CtxMenuShell>
  );
}
