import { useNavigate } from 'react-router-dom';
import { useCollectionStore } from '../store/collection';
import type { ImportRoutingSummary as Summary } from '../lib/import-routing';

interface Props {
  summary: Summary;
  onDismiss: () => void;
}

/**
 * Renders right after a successful import to answer "where did my cards go?"
 * — one row per destination binder, plus the Uncategorized bucket if any
 * cards fell through. Each binder row is a navigation link that opens the
 * binder with that tab active. Uncategorized is not clickable since there
 * is no deep-link to the collection-level Uncategorized filter.
 *
 * Hidden entirely when the summary is empty (e.g. binder-mode imports that
 * pin every card to a single new binder — the existing success banner
 * already calls that out).
 */
export function ImportRoutingSummary({ summary, onDismiss }: Props) {
  const navigate = useNavigate();
  const setActiveTab = useCollectionStore((s) => s.setActiveTab);

  if (summary.entries.length === 0) return null;

  const handleOpen = (binderId: string) => {
    setActiveTab(binderId);
    navigate(`/collection/binders/${binderId}`);
  };

  return (
    <div className="import-routing">
      <div className="import-routing-header">
        <span>
          <strong>
            Routed {summary.totalRouted} card{summary.totalRouted === 1 ? '' : 's'}
          </strong>{' '}
          to:
        </span>
        <button type="button" className="banner-dismiss" onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      </div>
      <ul className="import-routing-list">
        {summary.entries.map((entry) =>
          entry.binderId ? (
            <li key={entry.binderId}>
              <button
                type="button"
                className="import-routing-row"
                onClick={() => handleOpen(entry.binderId!)}
              >
                <span
                  className="import-routing-pip"
                  style={{ background: entry.binderColor ?? 'var(--text3)' }}
                  aria-hidden="true"
                />
                <span className="import-routing-name">{entry.binderName}</span>
                <span className="import-routing-count">
                  {entry.count} card{entry.count === 1 ? '' : 's'}
                </span>
              </button>
            </li>
          ) : (
            <li key="uncategorized">
              <div className="import-routing-row import-routing-row--static">
                <span className="import-routing-pip import-routing-pip--uncat" aria-hidden="true" />
                <span className="import-routing-name">{entry.binderName}</span>
                <span className="import-routing-count">
                  {entry.count} card{entry.count === 1 ? '' : 's'}
                </span>
              </div>
            </li>
          )
        )}
      </ul>
    </div>
  );
}
