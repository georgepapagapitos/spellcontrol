import { ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { RulesBundle } from '@/lib/cards/comprehensive-rules';
import './RuleCitations.css';

interface Props {
  /** Rule numbers, in the order the step cites them. */
  numbers: string[];
  bundle: RulesBundle | null | 'error';
}

/**
 * The rules behind one walkthrough step, in the Ask tab's "Rules cited" rows:
 * each number with its text on one line, tapping a row opens the full rule.
 * The text comes from the offline bundle; while it loads, the numbers stand
 * alone.
 */
export function RuleCitations({ numbers, bundle }: Props) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const text = useMemo(() => {
    const m = new Map<string, string>();
    if (bundle && bundle !== 'error') {
      const wanted = new Set(numbers);
      for (const r of bundle.rules) if (wanted.has(r.number)) m.set(r.number, r.text);
    }
    return m;
  }, [bundle, numbers]);

  const toggle = (n: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });

  return (
    <section aria-label="Rules for this step">
      <ul className="list-stack list-stack--tight" role="list">
        {numbers.map((n) => {
          const body = text.get(n);
          const isOpen = open.has(n);
          return (
            <li key={n} className="rules-cite">
              <button
                type="button"
                className="rules-cite-toggle"
                aria-expanded={body ? isOpen : undefined}
                disabled={!body}
                onClick={() => toggle(n)}
              >
                <span className="rules-cite-ref">{n}</span>
                {body ? (
                  <span className={`rules-cite-text${isOpen ? '' : ' rules-cite-text--clamped'}`}>
                    {body}
                  </span>
                ) : bundle === null ? (
                  <span className="rules-cite-skeleton" aria-hidden="true" />
                ) : null}
                {body && (
                  <ChevronDown
                    className={`rules-cite-chevron${isOpen ? ' rules-cite-chevron--open' : ''}`}
                    width={16}
                    height={16}
                    aria-hidden
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {bundle === 'error' && (
        <p className="rules-cite-note" role="status">
          Couldn't load the rule text. Check your connection and try again.
        </p>
      )}
    </section>
  );
}
