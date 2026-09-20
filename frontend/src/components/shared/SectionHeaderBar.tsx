import { ChevronDown } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import type { SectionHeader } from '../../lib/group-sections';

/**
 * The group divider inside a grouped card list: a disclosure button carrying a
 * chevron, an optional colour pip, the section's label, and its count.
 *
 * It lives here rather than in `CardListTable` because a binder's list needs
 * the same bar. A binder used to render the PAGE-GRID section header instead —
 * `.section-header-toggle`, a detached bar with its own bottom border and
 * margin, which is right above a block of full-size card pages and wrong above
 * a table: it split the table into three unconnected slabs (the column header,
 * the floating section bar, and the rows in their own rounded box).
 *
 * The `className` carries the per-surface look; this owns the button reset, the
 * rotating chevron and the expanded/collapsed a11y state.
 */
export function SectionHeaderBar({
  pip,
  pipSlot,
  label,
  count,
  meta,
  collapsed,
  onToggle,
  className,
  style,
  tabIndex,
  title,
  id,
  controls,
}: {
  pip?: SectionHeader['meta']['pip'];
  /**
   * Replaces the plain colour dot. A binder section is headed by the real mana
   * symbol (`ColorPip`), not a swatch, because the section IS a colour.
   */
  pipSlot?: ReactNode;
  label: string;
  /** Rows in the section. Always in the accessible name, even when `meta` replaces it visually. */
  count: number;
  /**
   * Replaces the bare count on the right. A binder says "40 cards · 29 unique",
   * because a physical binder's section has both a card count and a distinct-
   * printing count and they rarely match.
   */
  meta?: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  className: string;
  style?: CSSProperties;
  tabIndex?: number;
  title?: string;
  /** With `controls`, wires the bar to the region it discloses (a binder does). */
  id?: string;
  controls?: string;
}) {
  return (
    <button
      type="button"
      id={id}
      aria-controls={controls}
      className={`${className} collection-section-header-btn`}
      style={style}
      tabIndex={tabIndex}
      title={title}
      aria-expanded={!collapsed}
      aria-label={`${label}, ${count} cards, ${collapsed ? 'collapsed' : 'expanded'}`}
      onClick={onToggle}
    >
      <ChevronDown
        className="collection-section-chevron"
        width={16}
        height={16}
        strokeWidth={2.25}
        aria-hidden
        data-collapsed={collapsed || undefined}
      />
      {pipSlot ??
        (pip && (
          <span
            className="collection-list-section-pip"
            style={{ background: pip.background, borderColor: pip.border }}
            aria-hidden
          />
        ))}
      <span className="collection-list-section-label">{label}</span>
      <span className="collection-list-section-count">{meta ?? count}</span>
    </button>
  );
}
