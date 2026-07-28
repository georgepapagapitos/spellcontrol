import { useId, useState } from 'react';
import type { CardDelta } from '@/lib/deck-diff';
import './DiffCardRow.css';

/**
 * Shared card-delta row + collapsible group (T22, extracted for E173's
 * resync diff so it doesn't get re-derived on a second surface). Added /
 * removed / changed each get a text glyph + word so the signal is never
 * color-only (the tone class is purely additive) — see STYLE_GUIDE.
 */
export const TONE = {
  added: { cls: 'is-added', glyph: '+', word: 'Added' },
  removed: { cls: 'is-removed', glyph: '−', word: 'Removed' },
  changed: { cls: 'is-changed', glyph: '~', word: 'Changed' },
} as const;
export type Tone = keyof typeof TONE;

export function DiffCardRow({ delta, tone }: { delta: CardDelta; tone: Tone }) {
  const t = TONE[tone];
  const qty =
    tone === 'added'
      ? `+${delta.toQty}`
      : tone === 'removed'
        ? `−${delta.fromQty}`
        : `${delta.fromQty} → ${delta.toQty}`;
  const ariaLabel =
    tone === 'changed'
      ? `${t.word}: ${delta.card.name}, ${delta.fromQty} to ${delta.toQty} copies`
      : `${t.word}: ${delta.card.name}${delta.toQty + delta.fromQty > 1 ? `, ${Math.max(delta.toQty, delta.fromQty)} copies` : ''}`;
  return (
    <li className={`deck-diff-row ${t.cls}`} aria-label={ariaLabel}>
      <span className="deck-diff-bar" aria-hidden="true" />
      <span className="deck-diff-glyph" aria-hidden="true">
        {t.glyph}
      </span>
      <span className="deck-diff-name" title={delta.card.name}>
        {delta.card.name}
      </span>
      <span className="deck-diff-qty" aria-hidden="true">
        {qty}
      </span>
    </li>
  );
}

const COLLAPSE_AT = 8;

export function DiffGroup({ tone, deltas }: { tone: Tone; deltas: CardDelta[] }) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  if (deltas.length === 0) return null;
  const t = TONE[tone];
  const collapsible = deltas.length > COLLAPSE_AT;
  const visible = expanded || !collapsible ? deltas : deltas.slice(0, COLLAPSE_AT);
  const hidden = deltas.length - COLLAPSE_AT;
  return (
    <div className="deck-diff-group">
      <h3 className="deck-diff-group-title">
        {t.word} ({deltas.length})
      </h3>
      <ul className="deck-diff-list" id={listId} role="list">
        {visible.map((d) => (
          <DiffCardRow key={d.card.oracle_id || d.card.name} delta={d} tone={tone} />
        ))}
      </ul>
      {collapsible && (
        <button
          type="button"
          className="deck-diff-show-more"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Show fewer' : `Show ${hidden} more`}
        </button>
      )}
    </div>
  );
}
