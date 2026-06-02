import './CollapsibleLane.css';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

export interface CollapsibleLaneHandle {
  /** Expand the lane, scroll it into view, and move focus to its header — used
   *  when a hero move deep-links to this intent lane (keeps keyboard/AT focus
   *  with the revealed content). */
  reveal: () => void;
}

export interface CollapsibleLaneProps {
  /** Intent name, e.g. "Fill the gaps". */
  title: string;
  /** Leading glyph (lucide icon element). */
  icon?: ReactNode;
  /** Compact at-a-glance summary chips shown in the collapsed header. */
  summary?: ReactNode;
  /** First-paint collapse state when nothing is persisted (hero-pointed-expand). */
  defaultCollapsed: boolean;
  /** Per-lane localStorage key so a user's manual toggle survives reopen. */
  storageKey: string;
  children: ReactNode;
}

/** Read a persisted collapse pref, defaulting when storage is unavailable/empty. */
function readPref(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    return raw == null ? fallback : raw === '1';
  } catch {
    return fallback;
  }
}

function writePref(key: string, collapsed: boolean): void {
  try {
    window.localStorage.setItem(key, collapsed ? '1' : '0');
  } catch {
    /* storage unavailable (private mode / SSR) — non-fatal */
  }
}

/**
 * One Tune-tab intent lane: a collapsible section whose header mirrors the
 * house `deck-combos-header` chrome (icon + title + summary chips + chevron).
 * Default collapse follows the hero-pointed-expand rule, but a user's manual
 * toggle persists per lane; a hero deep-link force-expands via `reveal()`.
 */
export const CollapsibleLane = forwardRef<CollapsibleLaneHandle, CollapsibleLaneProps>(
  function CollapsibleLane({ title, icon, summary, defaultCollapsed, storageKey, children }, ref) {
    const [collapsed, setCollapsed] = useState<boolean>(() =>
      readPref(storageKey, defaultCollapsed)
    );
    const containerRef = useRef<HTMLDivElement>(null);
    const headerRef = useRef<HTMLButtonElement>(null);
    const bodyId = `tune-lane-${storageKey}`;

    useEffect(() => {
      writePref(storageKey, collapsed);
    }, [storageKey, collapsed]);

    useImperativeHandle(ref, () => ({
      reveal: () => {
        setCollapsed(false);
        window.requestAnimationFrame(() => {
          containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          headerRef.current?.focus();
        });
      },
    }));

    return (
      <div
        ref={containerRef}
        className={`tune-lane deck-combos-panel${collapsed ? ' is-collapsed' : ''}`}
        role="region"
        aria-label={title}
      >
        <button
          ref={headerRef}
          type="button"
          className="deck-combos-header"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? `Expand ${title}` : `Collapse ${title}`}
        >
          {icon}
          <span className="deck-combos-title">{title}</span>
          {summary != null && (
            <span className="deck-combos-header-summary" aria-hidden>
              {summary}
            </span>
          )}
          <span className="deck-combos-header-trailing" aria-hidden>
            <span className="deck-combos-header-chevron">
              {collapsed ? (
                <ChevronDown width={16} height={16} />
              ) : (
                <ChevronUp width={16} height={16} />
              )}
            </span>
          </span>
        </button>

        <div id={bodyId} className="deck-combos-body" hidden={collapsed} aria-hidden={collapsed}>
          {children}
        </div>
      </div>
    );
  }
);
