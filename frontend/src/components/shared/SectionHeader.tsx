import type { ReactNode } from 'react';

/**
 * A section's header: title · meta · tools (STYLE_GUIDE § Layout system,
 * "Section header"). Home's `.home-section-head` is the reference.
 *
 * With nothing beside the title it is only the heading, so a section that
 * has no meta or tools gets no wrapper row. With either, the heading sits in
 * a row: `leading` (a collapse toggle, a glyph), the title, then `meta` (a
 * count or a sub-line, rendered as given), then `tools` in their own group at
 * the end, or straight into the row as its last items when there is no
 * `toolsClassName` to give the group.
 *
 * `as="header"` makes the row the section's `<header>`, and a header is
 * always the row: it stays one element whether or not anything sits beside
 * the title, so a tool that comes and goes never changes its layout.
 * `titleAfter` follows the heading (a gauge, which a heading can't hold), and
 * `titleWrapClassName` wraps the two as one cell of the row.
 *
 * `variant` is the heading's role, painted once in base-layout.css: a
 * `title` (serif, --text-lg, Home's reference) or an `overline` (a small
 * uppercase serif label above its rows). `className` goes on the row, or on
 * the heading when there is no row; a family class keeps its own spacing.
 */

export interface SectionHeaderProps {
  title: ReactNode;
  /** The heading's id, for the section's `aria-labelledby`. */
  id?: string;
  /** Defaults to 2: a page's sections sit under its one `h1`. */
  level?: 2 | 3 | 4;
  /** The heading's role: a section title (default) or an overline label. */
  variant?: 'title' | 'overline';
  /** The row's element. A `header` is always rendered as the row. */
  as?: 'div' | 'header';
  className?: string;
  titleClassName?: string;
  /** -1 makes the heading a programmatic focus target outside the tab order. */
  titleTabIndex?: -1;
  /** Right after the heading, e.g. a gauge (a heading holds phrasing only). */
  titleAfter?: ReactNode;
  /** Wraps the heading and `titleAfter` as one cell of the row. */
  titleWrapClassName?: string;
  /** Ahead of the heading: a collapse toggle, a section glyph. */
  leading?: ReactNode;
  meta?: ReactNode;
  tools?: ReactNode;
  toolsClassName?: string;
}

export function SectionHeader({
  title,
  id,
  level = 2,
  variant = 'title',
  as: Row = 'div',
  className,
  titleClassName,
  titleTabIndex,
  titleAfter,
  titleWrapClassName,
  leading,
  meta,
  tools,
  toolsClassName,
}: SectionHeaderProps) {
  const H = `h${level}` as const;
  const row = Row === 'header' || !!(meta || tools || leading || titleAfter || titleWrapClassName);
  const heading = (
    <H
      id={id}
      className={row ? titleClassName : (className ?? titleClassName)}
      tabIndex={titleTabIndex}
      data-heading={variant}
    >
      {title}
    </H>
  );
  if (!row) return heading;
  return (
    <Row className={className}>
      {leading}
      {titleWrapClassName ? (
        <div className={titleWrapClassName}>
          {heading}
          {titleAfter}
        </div>
      ) : (
        <>
          {heading}
          {titleAfter}
        </>
      )}
      {meta}
      {tools && (toolsClassName ? <div className={toolsClassName}>{tools}</div> : tools)}
    </Row>
  );
}
