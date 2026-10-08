import { useEffect, useState, type ReactNode } from 'react';
import { getSuggestionStats, type SuggestionStats } from '@/lib/account/admin-api';
import { userMessage } from '@/lib/util/user-error';

/** Same keyboard-focusable scroll region AdminPage gives its tables. */
function Region({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="admin-table-scroll" role="region" aria-label={label} tabIndex={0}>
      <table className="admin-table admin-table--dense">{children}</table>
    </div>
  );
}

const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : 'n/a');

/**
 * Suggestion labels (E518) for the last 30 days: per surface, how many
 * suggestions were shown, accepted, dismissed and undone, then the cards cut
 * most per commander. Aggregate only; the table behind it has no user or deck.
 */
export function SuggestionLabelsTable() {
  const [stats, setStats] = useState<SuggestionStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getSuggestionStats(30)
      .then(setStats)
      .catch((err) => setError(userMessage(err, "Couldn't load the suggestion labels.")));
  }, []);

  if (error) {
    return (
      <p className="admin-warn" role="alert">
        {error}
      </p>
    );
  }
  if (stats === null) return <p className="admin-sub">Loading suggestion labels…</p>;
  return (
    <>
      <Region label="Suggestions by surface">
        <caption>Suggestions by surface (last 30 days)</caption>
        <thead>
          <tr>
            <th scope="col">Surface</th>
            <th scope="col">Shown</th>
            <th scope="col">Accepted</th>
            <th scope="col">Accept rate</th>
            <th scope="col">Dismissed</th>
            <th scope="col">Undone</th>
          </tr>
        </thead>
        <tbody>
          {stats.surfaces.length === 0 && (
            <tr>
              <td colSpan={6}>No suggestion labels yet.</td>
            </tr>
          )}
          {stats.surfaces.map((r) => (
            <tr key={r.surface}>
              <th scope="row">{r.surface}</th>
              <td>{r.shown.toLocaleString()}</td>
              <td>{r.accept.toLocaleString()}</td>
              <td>{pct(r.accept, r.shown)}</td>
              <td>{r.dismiss.toLocaleString()}</td>
              <td>{r.undo.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </Region>
      <Region label="Most dismissed cards by commander">
        <caption>Most dismissed cards by commander</caption>
        <thead>
          <tr>
            <th scope="col">Commander</th>
            <th scope="col">Dismissals</th>
            <th scope="col">Cards cut most</th>
          </tr>
        </thead>
        <tbody>
          {stats.topDismissed.length === 0 && (
            <tr>
              <td colSpan={3}>Nothing dismissed yet.</td>
            </tr>
          )}
          {stats.topDismissed.map((c) => (
            <tr key={c.commander}>
              <th scope="row">{c.name || c.commander}</th>
              <td>{c.total.toLocaleString()}</td>
              <td>{c.cards.map((x) => `${x.card} (${x.count})`).join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </Region>
    </>
  );
}
