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
 * Cards that matched no binder (the Uncategorized remainder) are intentionally
 * not shown — falling through just means "still in your collection, unrouted",
 * a no-op default not worth surfacing (E11). So the section is hidden entirely
 * when nothing matched a real binder (or for binder-mode imports that pin every
 * card to a single new binder) — the review surface's success line already
 * confirms the import landed.
 */
export function ImportRoutingSummary({ summary }: Props) {
  const navigate = useNavigate();
  const setActiveTab = useCollectionStore((s) => s.setActiveTab);

  if (summary.entries.length === 0) return null;

  const handleOpen = (binderId: string) => {
    setActiveTab(binderId);
    navigate(`/collection/binders/${binderId}`);
  };

  return (
    <>
      <div className="import-routing-header">
        <span>
          <strong>
            Routed {summary.totalRouted} card{summary.totalRouted === 1 ? '' : 's'}
          </strong>{' '}
          to:
        </span>
      </div>
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
      </ul>
    </>
  );
}
