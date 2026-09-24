import { useMemo } from 'react';
import { countBinderMatches } from '../lib/binder-counts';
import { STARTER_TEMPLATES, type StarterTemplate } from '../lib/binder-templates';
import { useCardTagsError, useCardTagsReady, useCardsWithTags } from '../lib/card-tags';
import type { BinderFilter, EnrichedCard } from '../types';

export type BinderStart =
  | { kind: 'template'; template: StarterTemplate }
  | { kind: 'blank' }
  | { kind: 'import' };

/** Templates that need a choice before they mean anything show no count. */
const PICK_NEXT: Record<string, string> = {
  'one-color': 'Pick the color next',
  set: 'Pick the set next',
};

const usesTags = (f: Partial<BinderFilter> | undefined) => !!f?.oracleTagChips?.chips.length;

/**
 * A new binder's first step: what goes in it. Templates come first because
 * they are the fastest way to a useful binder, and each one says how many of
 * YOUR cards it would take before you commit. "From a list" is a start of its
 * own rather than a mode toggle halfway down the form, because an imported
 * binder shares almost nothing with a rules binder.
 */
export function BinderStartChooser({
  cards,
  onPick,
}: {
  cards: EnrichedCard[];
  onPick: (start: BinderStart) => void;
}) {
  const tagged = useCardsWithTags(cards, true);
  const tagsReady = useCardTagsReady(true);
  // A failed tag load leaves those tiles without a count rather than on a
  // "Counting…" that never resolves; the template itself still works.
  const tagsFailed = useCardTagsError();

  const counts = useMemo(() => {
    const out = new Map<string, number>();
    for (const t of STARTER_TEMPLATES) {
      if (!t.filter || PICK_NEXT[t.id]) continue;
      out.set(t.id, countBinderMatches(tagged, [{ filter: t.filter }], false).total);
    }
    return out;
  }, [tagged]);

  const countLine = (t: StarterTemplate): string | null => {
    if (PICK_NEXT[t.id]) return PICK_NEXT[t.id];
    if (usesTags(t.filter) && !tagsReady) return tagsFailed ? null : 'Counting…';
    const n = counts.get(t.id) ?? 0;
    return `${n.toLocaleString()} of your ${n === 1 ? 'card' : 'cards'}`;
  };

  return (
    <div className="binder-start">
      <div className="binder-start-head">
        <h3 className="binder-start-title">What goes in it?</h3>
        <p className="binder-start-sub">You can change everything after.</p>
      </div>
      <div className="binder-start-tiles">
        {STARTER_TEMPLATES.map((t, i) => (
          <button
            key={t.id}
            type="button"
            // Start on the first choice, not on the dialog's close button.
            autoFocus={i === 0}
            className="binder-start-tile"
            onClick={() => onPick({ kind: 'template', template: t })}
          >
            <span className="binder-start-tile-label">{t.label}</span>
            <span className="binder-start-tile-desc">{t.description}</span>
            {countLine(t) && <span className="binder-start-tile-count">{countLine(t)}</span>}
          </button>
        ))}
        <button
          type="button"
          className="binder-start-tile binder-start-tile--alt"
          onClick={() => onPick({ kind: 'blank' })}
        >
          <span className="binder-start-tile-label">Blank</span>
          <span className="binder-start-tile-desc">Write your own rules</span>
        </button>
        <button
          type="button"
          className="binder-start-tile binder-start-tile--alt binder-start-tile--wide"
          onClick={() => onPick({ kind: 'import' })}
        >
          <span className="binder-start-tile-label">From a list</span>
          <span className="binder-start-tile-desc">
            Paste a list or upload CSV files. Cards are added and kept in your order.
          </span>
        </button>
      </div>
    </div>
  );
}
