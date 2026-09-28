import type { ReactNode } from 'react';
import { joinClasses } from '@/lib/join-classes';

interface PrimaryProps {
  compact?: false;
  /** Short tagline naming the state ("No decks yet."). Rendered `<p>` by
   *  default; pass `taglineAs="h1"` for a page-level empty that is the
   *  page's whole content (the 404 view). */
  tagline: ReactNode;
  taglineAs?: 'p' | 'h1';
  /** One sentence giving the reason and the action that changes it. Omit
   *  only when the tagline alone already states both (rare). */
  hint?: ReactNode;
  /** One or more buttons/links performing the hint's action. Always wrapped
   *  in `.empty-state-actions` so a stack of them wraps and sizes together,
   *  matching every existing multi-action empty state. */
  actions?: ReactNode;
  /** Extra class merged onto the `.empty-state-actions` wrapper — for a page
   *  that needs its own test hook to disambiguate this action group from an
   *  identically-labeled control elsewhere on the page (e.g. DecksIndexPage's
   *  `.decks-empty-actions`), not for visual styling (put that on the
   *  buttons themselves). */
  actionsClassName?: string;
  /** This empty state replaces loading content (a skeleton) the user was
   *  just shown, so the region announces the transition to screen readers. */
  status?: boolean;
  className?: string;
}

interface CompactProps {
  /** A single quiet line for an in-panel/nested placeholder (a sideboard
   *  slot list, a secondary section's own "nothing here", a mini-chart's
   *  no-data line) — the two-part tagline/hint pattern reads visually heavy
   *  there (STYLE_GUIDE "Empty states": nested empties and secondary
   *  sections stay text-only, one quiet line). Never combined with hint. */
  compact: true;
  /** The line's own styling class, owned by the caller's stylesheet (e.g.
   *  the deck sections' `.deck-section-empty`, PodHubPage's `.pod-hub-stats-empty`)
   *  — EmptyState renders it as-is rather than shipping one fixed compact
   *  class every consumer would share (keeps `css-chunk-ownership.test.ts`
   *  happy: the class stays owned by the page/component that already loads
   *  its stylesheet). */
  className: string;
  /** `div` when the line carries its own nested paragraph(s) or a lone CTA
   *  (PodHubPage's "No games yet." + "Plan a game night" pairing) — a `<p>`
   *  can't validly nest a `<p>` or a block-level button wrapper. */
  as?: 'p' | 'div';
  children: ReactNode;
  status?: boolean;
  /** For a line that stands in for a collapsible list: the collapse
   *  control's `aria-controls` target, hidden with the list it replaces
   *  (an empty sideboard or Considering section). */
  id?: string;
  hidden?: boolean;
}

type EmptyStateProps = PrimaryProps | CompactProps;

/**
 * The ONE empty-state primitive — see STYLE_GUIDE.md "Empty states" (E182)
 * and "Voice & copy". Renders the shared `.empty-state` / `.empty-state-tagline`
 * / `.empty-state-hint` / `.empty-state-actions` markup so every "nothing
 * here" surface looks the same; never hand-roll this className family
 * outside this file (guarded by `src/test/empty-state-primitive.test.ts`).
 */
export function EmptyState(props: EmptyStateProps) {
  if (props.compact) {
    const Tag = props.as ?? 'p';
    return (
      <Tag
        className={props.className}
        id={props.id}
        hidden={props.hidden}
        role={props.status ? 'status' : undefined}
      >
        {props.children}
      </Tag>
    );
  }

  const {
    tagline,
    taglineAs: TaglineTag = 'p',
    hint,
    actions,
    actionsClassName,
    status = false,
    className,
  } = props;

  return (
    <div className={joinClasses('empty-state', className)} role={status ? 'status' : undefined}>
      <TaglineTag className="empty-state-tagline">{tagline}</TaglineTag>
      {hint && <p className="empty-state-hint">{hint}</p>}
      {actions && (
        <div className={joinClasses('empty-state-actions', actionsClassName)}>{actions}</div>
      )}
    </div>
  );
}
