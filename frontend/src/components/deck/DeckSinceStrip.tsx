import { useId, useState, type JSX } from 'react';
import { ChevronDown, History, X } from 'lucide-react';
import { IconButton } from '@/components/shared/Button';
import {
  baselineLabel,
  roleWord,
  sinceSummary,
  type DeckSince,
  type SinceCard,
  type SinceRow,
} from '@/lib/deck/deck-since';
import { TONE } from './DiffCardRow';
import './DiffCardRow.css';
import './DeckSinceStrip.css';

const COLLAPSE_AT = 8;
function MetricRow({ row }: { row: SinceRow }): JSX.Element {
  return (
    <li className="deck-since-metric">
      <span className="deck-since-metric-label">{row.label}</span>
      <span className="deck-since-metric-change">
        {row.fromText} to {row.toText}
        <span className="sr-only">{row.direction === 'up' ? ', up' : ', down'}</span>
      </span>
    </li>
  );
}

function CardGroup({
  tone,
  cards,
}: {
  tone: 'added' | 'removed';
  cards: SinceCard[];
}): JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  if (cards.length === 0) return null;
  const t = TONE[tone];
  const shown = expanded ? cards : cards.slice(0, COLLAPSE_AT);
  return (
    <div className="deck-since-cards">
      <h3 className="deck-diff-group-title">
        {t.word} ({cards.reduce((n, c) => n + c.qty, 0)})
      </h3>
      <ul className="deck-diff-list" id={listId} role="list">
        {shown.map((c) => {
          const roles = c.roles.map(roleWord).join(', ');
          return (
            <li
              key={c.name}
              className={`deck-diff-row ${t.cls}`}
              aria-label={`${t.word}: ${c.name}${c.qty > 1 ? `, ${c.qty} copies` : ''}${roles ? `, ${roles}` : ''}`}
            >
              <span className="deck-diff-bar" aria-hidden="true" />
              <span className="deck-diff-glyph" aria-hidden="true">
                {t.glyph}
              </span>
              <span className="deck-diff-name" title={c.name}>
                {c.name}
                {roles && (
                  <span className="deck-since-roles" aria-hidden="true">
                    {roles}
                  </span>
                )}
              </span>
              <span className="deck-diff-qty" aria-hidden="true">
                {c.qty > 1 ? `${tone === 'added' ? '+' : '−'}${c.qty}` : ''}
              </span>
            </li>
          );
        })}
      </ul>
      {cards.length > COLLAPSE_AT && (
        <button
          type="button"
          className="deck-diff-show-more"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Show fewer' : `Show ${cards.length - COLLAPSE_AT} more`}
        </button>
      )}
    </div>
  );
}

/**
 * The deck's "Since" read (E1038 3.4): one line of what moved since the
 * baseline, expanding to every metric and the cards behind them. Mounted by the
 * page only when something changed. The summary is a native disclosure, so
 * keyboard and screen-reader behavior come with it; "Mark as seen" is a
 * sibling control, never nested in the summary.
 */
export function DeckSinceStrip({
  since,
  baselineAt,
  onDismiss,
}: {
  since: DeckSince;
  baselineAt: number;
  onDismiss: () => void;
}): JSX.Element {
  return (
    <section className="deck-since" aria-label="Changes since you last looked">
      <details className="deck-since-details">
        <summary className="deck-since-summary">
          <History className="deck-since-icon" width={16} height={16} aria-hidden="true" />
          <span className="deck-since-text">
            <span className="deck-since-when">Since {baselineLabel(baselineAt)}</span>
            <span className="deck-since-line">{sinceSummary(since)}</span>
          </span>
          <ChevronDown className="deck-since-chevron" aria-hidden="true" />
        </summary>
        <div className="deck-since-body">
          {since.rows.length > 0 && (
            <ul className="deck-since-metrics" role="list">
              {since.rows.map((r) => (
                <MetricRow key={r.key} row={r} />
              ))}
            </ul>
          )}
          <CardGroup tone="added" cards={since.added} />
          <CardGroup tone="removed" cards={since.removed} />
        </div>
      </details>
      <IconButton
        className="deck-since-dismiss"
        onClick={onDismiss}
        label="Mark changes as seen"
        icon={<X width={14} height={14} strokeWidth={1.8} />}
      />
    </section>
  );
}
