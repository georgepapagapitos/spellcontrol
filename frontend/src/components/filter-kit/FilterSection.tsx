import { useId, type ReactNode } from 'react';
import { Count } from '@/components/shared/Count';
import '@/components/shared/form.css';
import './filter-kit.css';

/**
 * One heading style for every filter surface (STYLE_GUIDE § Filter kit): the
 * section heading (`.form-section-heading`, sentence case, E595) plus a count of how many values in
 * the section are on, so what is set reads without opening anything. The
 * section is a labelled region; the count is spoken as part of the heading
 * ("Rarity, 2 selected").
 */
export function FilterSection({
  label,
  count = 0,
  children,
}: {
  label: ReactNode;
  /** Values on in this section. Nothing renders at zero. */
  count?: number;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="filter-kit-section" aria-labelledby={id}>
      <h3 id={id} className="form-section-heading filter-kit-label">
        {label}
        <Count
          className="filter-kit-count"
          value={count}
          placement="inline"
          tone="accent"
          label={`${count} selected`}
        />
      </h3>
      {children}
    </section>
  );
}
