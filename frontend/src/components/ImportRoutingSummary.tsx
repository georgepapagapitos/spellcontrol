import { useNavigate } from 'react-router-dom';
import { useCollectionStore } from '../store/collection';
import type { ImportRoutingSummary as Summary } from '../lib/import-routing';

interface Props {
  summary: Summary;
}

/**
 * Renders inside the post-import review surface (E130) to answer "where did
 * my cards go?" — one row per destination binder, each a navigation link
 * that opens the binder with that tab active. Just the header line + row
 * list: the host (`UploadPanel`'s `.import-review` container) owns the box
 * chrome and the single overall dismiss.
 *
 * Cards that matched no binder get one final row of their own (E296): they are
 * the signal that a rule is missing, and until this existed the panel said
 * "Routed 312 cards" and nothing at all about the other 88 — reachable only via
 * a Collection filter the user had to already know about. The row has no binder
 * to open, so it deep-links to the Collection filtered to Uncategorized.
 *
 * The whole section hides only when the import produced no routing story at
 * all (nothing matched a binder AND nothing fell through) — the review
 * surface's success line already confirms the import landed.
 */
export function ImportRoutingSummary({ summary }: Props) {
  const navigate = useNavigate();
  const setActiveTab = useCollectionStore((s) => s.setActiveTab);

  if (summary.entries.length === 0 && summary.unroutedCount === 0) return null;

  const handleOpen = (binderId: string) => {
    setActiveTab(binderId);
    navigate(`/collection/binders/${binderId}`);
  };

  // No binder to open: hand the Collection page a pre-seeded binder filter so
  // the user lands on exactly the cards that escaped, ready to act on.
  const handleOpenUnrouted = () => navigate('/collection?binder=__uncategorized');

  return (
    <>
      {summary.entries.length > 0 && (
        <div className="import-routing-header">
          <span>
            <strong>
              Routed {summary.totalRouted} card{summary.totalRouted === 1 ? '' : 's'}
            </strong>{' '}
            to:
          </span>
        </div>
      )}
      <ul className="import-routing-list">
        {summary.entries.map((entry) => (
          <li key={entry.binderId}>
            <button
              type="button"
              className="import-routing-row"
              onClick={() => handleOpen(entry.binderId)}
            >
              <span
                className="import-routing-pip"
                style={{ background: entry.binderColor ?? 'var(--text-muted)' }}
                aria-hidden="true"
              />
              <span className="import-routing-name">{entry.binderName}</span>
              <span className="import-routing-count">
                {entry.count} card{entry.count === 1 ? '' : 's'}
              </span>
            </button>
          </li>
        ))}
        {summary.unroutedCount > 0 && (
          <li>
            <button
              type="button"
              className="import-routing-row import-routing-row--unrouted"
              onClick={handleOpenUnrouted}
            >
              <span className="import-routing-pip import-routing-pip--empty" aria-hidden="true" />
              <span className="import-routing-name">
                Matched no binder
                <span className="import-routing-hint">
                  {summary.unroutedCount === 1 ? 'Review it' : 'Review them'} and add a rule
                </span>
              </span>
              <span className="import-routing-count">
                {summary.unroutedCount} card{summary.unroutedCount === 1 ? '' : 's'}
              </span>
            </button>
          </li>
        )}
      </ul>
    </>
  );
}
