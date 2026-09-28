import type { ReactNode } from 'react';

/**
 * A section's header: title · meta · tools (STYLE_GUIDE § Layout system,
 * "Section header"). Home's `.home-section-head` is the reference.
 *
 * With nothing beside the title it is only the heading, so a section that
 * has no meta or tools gets no wrapper row. With either, the heading sits in
 * a row: the title, then `meta` (a count or a sub-line, rendered as given),
 * then `tools` in their own group at the end.
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
  className?: string;
  titleClassName?: string;
  meta?: ReactNode;
  tools?: ReactNode;
  toolsClassName?: string;
}

export function SectionHeader({
  title,
  id,
  level = 2,
  variant = 'title',
  className,
  titleClassName,
  meta,
  tools,
  toolsClassName,
}: SectionHeaderProps) {
  const H = `h${level}` as const;
  if (!meta && !tools)
    return (
      <H id={id} className={className ?? titleClassName} data-heading={variant}>
        {title}
      </H>
    );
  return (
    <div className={className}>
      <H id={id} className={titleClassName} data-heading={variant}>
        {title}
      </H>
      {meta}
      {tools && <div className={toolsClassName}>{tools}</div>}
    </div>
  );
}
