import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { CtxMenuShell } from '@/components/shared/CtxMenuShell';
import { getSafeViewport } from '@/lib/popover-placement';

export interface TableMenuItem {
  /** Names a row so a caller can open the menu with it already open (the
   *  counters key opens straight onto Counters). */
  id?: string;
  label: string;
  /** Shown right-aligned in a `<kbd>`; the key itself is bound in PlaytestBoard. */
  shortcut?: string;
  onClick?(): void;
  disabled?: boolean;
  /** Present makes the row a toggle, and says which way it is set. */
  pressed?: boolean;
  /** Rows this one opens. A row has this (or `content`) or `onClick`, never both. */
  items?: MenuEntry[];
  /** A control rather than a list of rows — a count stepper, the counter
   *  steppers. Renders above `items` when a row has both, and the caller
   *  closes the menu itself when the control is done. */
  content?: ReactNode;
}

/** A line between two groups of rows. */
export const SEPARATOR = '-' as const;
export type MenuEntry = TableMenuItem | typeof SEPARATOR;

interface Props {
  x: number;
  y: number;
  variant: 'floating' | 'sheet';
  items: MenuEntry[];
  /** Accessible name, and the sheet variant's visible heading. Defaults to
   *  the felt's own menu; a zone pile passes its zone ("Library") so the
   *  menu says which pile it belongs to. */
  title?: string;
  /** Lines above the root rows — "3 cards selected", a commander's tax. */
  header?: ReactNode;
  /** The `id` of a row to open on arrival. */
  openId?: string;
  onClose(): void;
}

/** How long the pointer rests on a row before its submenu opens or the open
 *  one closes. Long enough to cross a sibling row on the way into a submenu,
 *  short enough that nobody waits for it. */
const HOVER_MS = 150;
const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled)';
const isSubmenu = (item: TableMenuItem) => Boolean(item.items || item.content);

/** Separators only ever sit BETWEEN rows. Conditional rows drop out of a
 *  caller's list, and this keeps that from leaving a line at either end or
 *  two in a row. */
function tidy(entries: MenuEntry[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const e of entries) {
    if (e === SEPARATOR && (out.length === 0 || out[out.length - 1] === SEPARATOR)) continue;
    out.push(e);
  }
  if (out[out.length - 1] === SEPARATOR) out.pop();
  return out;
}

/** The open submenus along `path`, outermost first. */
function levels(root: MenuEntry[], path: number[]): { item: TableMenuItem; rows: MenuEntry[] }[] {
  const out: { item: TableMenuItem; rows: MenuEntry[] }[] = [];
  let rows = tidy(root);
  for (const i of path) {
    const item = rows[i];
    if (!item || item === SEPARATOR) break;
    rows = tidy(item.items ?? []);
    out.push({ item, rows });
  }
  return out;
}

function pathTo(entries: MenuEntry[], id: string): number[] | null {
  const rows = tidy(entries);
  for (let i = 0; i < rows.length; i++) {
    const e = rows[i];
    if (e === SEPARATOR) continue;
    if (e.id === id) return [i];
    const below = e.items && pathTo(e.items, id);
    if (below) return [i, ...below];
  }
  return null;
}

/** Up/Down walk the rows of the panel focus is in, and wrap. */
function arrowNav(e: React.KeyboardEvent<HTMLElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const target = e.target as HTMLElement;
  const panel = target.closest('[data-menu-panel]');
  if (!panel || target.tagName === 'INPUT') return;
  const rows = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.closest('[data-menu-panel]') === panel
  );
  const at = rows.indexOf(target);
  const next = rows[(at + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length];
  if (next) {
    e.preventDefault();
    next.focus();
  }
}

/** The row at `path` anywhere in this menu, root panel or submenu. */
function findRow(root: RefObject<HTMLElement | null>, path: string): HTMLElement | null {
  return (
    root.current?.closest('.ctx-menu')?.querySelector<HTMLElement>(`[data-menu-path="${path}"]`) ??
    null
  );
}

/**
 * A submenu beside the row that opened it — to its right, or its left when
 * the right would run off the screen — and kept inside the viewport
 * vertically.
 */
function Flyout({
  root,
  anchorPath,
  level,
  label,
  focusOnOpen,
  onPointerEnter,
  children,
}: {
  root: RefObject<HTMLElement | null>;
  anchorPath: string;
  level: number;
  label: string;
  focusOnOpen: boolean;
  onPointerEnter(): void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current;
      const row = findRow(root, anchorPath);
      if (!el || !row) return;
      const r = row.getBoundingClientRect();
      const { width, height } = el.getBoundingClientRect();
      const safe = getSafeViewport();
      const margin = 8;
      // The panel's own padding, so its first row lines up with the row it
      // came from rather than its top edge.
      const inset = 6;
      let left = r.right + 2;
      if (left + width > safe.right - margin) left = Math.max(margin, r.left - width - 2);
      const top = Math.max(margin, Math.min(r.top - inset, safe.bottom - height - margin));
      setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
    };
    place();
    // Once more a frame later: a menu that opens WITH a submenu open (the J
    // key) places it before the shell has clamped the root panel into view.
    const frame = requestAnimationFrame(place);
    return () => cancelAnimationFrame(frame);
  }, [root, anchorPath]);

  useEffect(() => {
    // Only once visible: a `visibility: hidden` panel cannot take focus.
    if (pos && focusOnOpen) ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }, [pos, focusOnOpen]);

  return (
    <div
      ref={ref}
      className="ctx-menu ctx-menu-items playtest-ctx-flyout"
      role="menu"
      aria-label={label}
      data-menu-panel={level}
      style={{
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        visibility: pos ? 'visible' : 'hidden',
      }}
      onPointerEnter={onPointerEnter}
    >
      {children}
    </div>
  );
}

/**
 * Every right-click menu on the table: the felt, the four piles, and a card
 * on the battlefield, in hand or in the command zone. One engine, so they all
 * move the same way — EDHPlay's way, since that is the table these players
 * arrive from:
 *
 * - With a pointer, a `▸` row opens its submenu BESIDE the menu on hover (or
 *   a click, or →), and ← or hovering a sibling row closes it again. The root
 *   stays put, so the path you took stays in view.
 * - In the bottom sheet, where there is no room beside anything, the same
 *   tree drills down a page at a time with a back row.
 *
 * Rows print their key binding — this menu is where the board's shortcuts are
 * discovered — and `SEPARATOR` groups them the way the actions group at a
 * table.
 */
export function TableContextMenu({ x, y, variant, items, title, header, openId, onClose }: Props) {
  const [path, setPath] = useState<number[]>(() => (openId && pathTo(items, openId)) || []);
  // The level whose first row takes focus when it opens: a click or → hands
  // the keyboard to the submenu, a hover leaves focus where it is.
  const [focusLevel, setFocusLevel] = useState<number | null>(() =>
    openId ? (pathTo(items, openId)?.length ?? null) : null
  );
  const rootRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootTitle = title ?? 'Table actions';
  const open = levels(items, path);
  const floating = variant === 'floating';

  const cancelHover = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancelHover, []);

  function openSubmenu(level: number, i: number, focus: boolean) {
    cancelHover();
    setPath((p) => [...p.slice(0, level), i]);
    setFocusLevel(focus ? level + 1 : null);
  }

  function hover(level: number, i: number, item: TableMenuItem) {
    cancelHover();
    timer.current = setTimeout(() => {
      // Someone typing a counter name in an open submenu has not left it just
      // because the pointer drifted back across the menu.
      const active = document.activeElement;
      const typingIn = Number(
        active?.closest('[data-menu-panel]')?.getAttribute('data-menu-panel')
      );
      if (active instanceof HTMLInputElement && typingIn > level) return;
      if (isSubmenu(item) && !item.disabled) openSubmenu(level, i, false);
      else setPath((p) => p.slice(0, level));
    }, HOVER_MS);
  }

  /** Keys on a row: ↑/↓ walk its panel, → opens its submenu, ← backs out of
   *  a submenu to the row that opened it. */
  function rowKey(e: React.KeyboardEvent<HTMLElement>, level: number, prefix: number[]) {
    if (floating && e.key === 'ArrowLeft' && level > 0) {
      e.preventDefault();
      setPath(path.slice(0, level - 1));
      findRow(rootRef, prefix.join('.'))?.focus();
    } else arrowNav(e);
  }

  function renderRows(rows: MenuEntry[], level: number, prefix: number[]) {
    return rows.map((item, i) => {
      if (item === SEPARATOR)
        return <div key={`sep-${i}`} role="separator" className="playtest-ctx-sep" />;
      const here = [...prefix, i].join('.');
      const onPointerEnter = floating
        ? (e: React.PointerEvent) => {
            if (e.pointerType === 'mouse') hover(level, i, item);
          }
        : undefined;
      if (isSubmenu(item)) {
        const isOpen = floating && path.length > level && path[level] === i;
        return (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            data-menu-path={here}
            className={`playtest-ctx-action playtest-ctx-action--submenu${isOpen ? ' is-open' : ''}`}
            aria-haspopup="menu"
            aria-expanded={floating ? isOpen : undefined}
            disabled={item.disabled}
            onPointerEnter={onPointerEnter}
            onClick={() => (floating ? openSubmenu(level, i, true) : setPath([...prefix, i]))}
            onKeyDown={(e) => {
              if (floating && e.key === 'ArrowRight') {
                e.preventDefault();
                openSubmenu(level, i, true);
              } else rowKey(e, level, prefix);
            }}
          >
            <span>{item.label}</span>
            <span className="playtest-ctx-action__end">
              {item.shortcut && <kbd className="playtest-ctx-key">{item.shortcut}</kbd>}
              <ChevronRight width={14} height={14} aria-hidden />
            </span>
          </button>
        );
      }
      return (
        <button
          key={item.label}
          type="button"
          // A toggle inside a menu is a menuitemcheckbox — `menuitem` does
          // not carry a checked state, and `aria-pressed` is a button's
          // idiom, not a menu's.
          role={item.pressed === undefined ? 'menuitem' : 'menuitemcheckbox'}
          aria-checked={item.pressed}
          data-menu-path={here}
          className="playtest-ctx-action"
          disabled={item.disabled}
          onPointerEnter={onPointerEnter}
          onKeyDown={(e) => rowKey(e, level, prefix)}
          onClick={() => {
            onClose();
            item.onClick?.();
          }}
        >
          <span>{item.label}</span>
          {item.shortcut && <kbd className="playtest-ctx-key">{item.shortcut}</kbd>}
        </button>
      );
    });
  }

  /** A submenu's body: its control, then its rows, a line between the two. */
  const body = (item: TableMenuItem, rows: MenuEntry[], level: number, prefix: number[]) => (
    <>
      {item.content}
      {item.content && rows.length > 0 && <div role="separator" className="playtest-ctx-sep" />}
      {renderRows(rows, level, prefix)}
    </>
  );

  if (!floating) {
    // One page at a time: the deepest open level, with a row back up.
    const current = open[open.length - 1];
    const backLabel = open.length > 1 ? open[open.length - 2].item.label : rootTitle;
    return (
      <CtxMenuShell
        x={x}
        y={y}
        title={current ? current.item.label : rootTitle}
        variant="sheet"
        // A page swap moves focus onto the new page's first row.
        contentKey={path.join('.')}
        onClose={onClose}
      >
        {current ? (
          <>
            <button
              type="button"
              role="menuitem"
              className="playtest-ctx-back"
              onClick={() => setPath(path.slice(0, -1))}
              aria-label={`Back to ${backLabel}`}
            >
              <ChevronLeft width={14} height={14} aria-hidden />
              <span>{backLabel}</span>
            </button>
            {body(current.item, current.rows, path.length, path)}
          </>
        ) : (
          <>
            {header}
            {renderRows(tidy(items), 0, [])}
          </>
        )}
      </CtxMenuShell>
    );
  }

  return (
    <CtxMenuShell x={x} y={y} title={rootTitle} variant="floating" onClose={onClose}>
      {/* `display: contents`, so the shell's padding and gap still lay these
          rows out; the wrapper only marks which panel ↑/↓ walk. */}
      <div ref={rootRef} className="playtest-ctx-panel" data-menu-panel={0}>
        {header}
        {renderRows(tidy(items), 0, [])}
      </div>
      {open.map(({ item, rows }, i) => {
        const level = i + 1;
        const at = path.slice(0, level);
        return (
          <Flyout
            key={at.join('.')}
            root={rootRef}
            anchorPath={at.join('.')}
            level={level}
            label={item.label}
            focusOnOpen={focusLevel === level}
            onPointerEnter={cancelHover}
          >
            {body(item, rows, level, at)}
          </Flyout>
        );
      })}
    </CtxMenuShell>
  );
}
