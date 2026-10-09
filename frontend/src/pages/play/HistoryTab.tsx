import { EmptyState } from '@/components/shared/EmptyState';
import { X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { aggregateDeckRecords, usePlayStore } from '@/store/play';
import { useDecksStore } from '@/store/decks';
import { ConfirmDialog } from '@/components/overlays/ConfirmDialog';
import { OverflowMenu, type OverflowMenuItem } from '@/components/overlays/OverflowMenu';
import { GameResultEditDialog } from '@/components/play/GameResultEditDialog';
import { Tabs } from '@/components/overlays/Tabs';
import { StackedBar } from '@/components/shared/MeterBar';
import { FriendsLeaderboard } from '@/components/play/FriendsLeaderboard';
import { aggregateMatchupRecords } from '@/lib/play/matchup-records';
import type { GameRecord } from '@spellcontrol/game-core';
import { coopResultLabel } from '@/lib/horde/horde-records';
import { Button, IconButton } from '@/components/shared/Button';
import '@/styles/social-shared.css';

type HistoryFilter = 'all' | 'local' | 'online';

/**
 * A local row this device or account owns. The only kind that can be
 * CORRECTED — the winner and deck attribution are the recorder's to fix, and
 * an online game's are the server's.
 */
function ownsRecord(rec: GameRecord, userId: string | null): boolean {
  if (rec.mode !== 'local') return false;
  if (userId === null) return true;
  return rec.recordedByUserId === undefined || rec.recordedByUserId === userId;
}

/** An online game this account made the table for. */
function hostsRecord(rec: GameRecord, userId: string | null): boolean {
  return rec.mode === 'online' && userId !== null && rec.hostUserId === userId;
}

/**
 * A row this account may delete outright: a local one it owns, or an online one
 * it HOSTED. The second is different in kind and the copy says so — deleting a
 * shared row takes the game out of every participant's history and out of the
 * win-loss they played into. The host made the table, which makes them the one
 * person who gets to bin a mis-started or test one.
 */
function canDeleteRecord(rec: GameRecord, userId: string | null): boolean {
  return ownsRecord(rec, userId) || hostsRecord(rec, userId);
}

/**
 * A row this account can see but never delete: an online game it did not host,
 * or a local one a friend recorded it into. It leaves their list and nothing
 * else - the game still counts in every win-loss.
 */
function canHideRecord(rec: GameRecord, userId: string | null): boolean {
  return userId !== null && !canDeleteRecord(rec, userId);
}

/** A guest's history is this device's alone, so anything on it can leave it. */
function canDropRecord(rec: GameRecord, userId: string | null): boolean {
  return userId === null || canDeleteRecord(rec, userId) || canHideRecord(rec, userId);
}

/** What leaving the list means for a row: gone for good, or out of sight. */
function dropKind(rec: GameRecord, userId: string | null): 'remove' | 'hide' {
  return canHideRecord(rec, userId) ? 'hide' : 'remove';
}

/**
 * The confirm body for dropping `records`, which may mix the two kinds. Each
 * kind is spelled out, because one is permanent and the other is not, and a
 * single sentence covering both would be true of neither.
 */
function dropConfirmBody(records: GameRecord[], userId: string | null): string {
  const dropping = records.filter((r) => dropKind(r, userId) === 'remove');
  // A hosted online game is a removal too, but not the same one: it is the
  // table's shared record, so it leaves everyone's history, not just yours.
  // Saying "leaves your history" about it would be false.
  const shared = dropping.filter((r) => r.mode === 'online').length;
  const removing = dropping.length - shared;
  const hiding = records.length - dropping.length;
  const parts: string[] = [];
  if (removing > 0) {
    parts.push(
      removing === 1
        ? 'One game leaves your history for good, along with the deck records built from it.'
        : `${removing} games leave your history for good, along with the deck records built from them.`
    );
  }
  if (shared > 0) {
    parts.push(
      shared === 1
        ? 'One game you hosted leaves the record for everyone who played it, and their win-loss with it.'
        : `${shared} games you hosted leave the record for everyone who played them, and their win-loss with them.`
    );
  }
  if (hiding > 0) {
    parts.push(
      hiding === 1
        ? 'One game leaves your list. The table keeps its record, and your win-loss still counts it.'
        : `${hiding} games leave your list. The table keeps its record, and your win-loss still counts them.`
    );
  }
  if (removing + shared > 0) parts.push("Removing can't be undone.");
  return parts.join(' ');
}

export function HistoryTab({
  history,
  userId,
  onRematch,
}: {
  history: GameRecord[];
  userId: string | null;
  onRematch: (rec: GameRecord) => void;
}) {
  const removeHistory = usePlayStore((s) => s.removeHistory);
  const editHistory = usePlayStore((s) => s.editHistory);
  const setHistoryHidden = usePlayStore((s) => s.setHistoryHidden);
  const loadHiddenHistory = usePlayStore((s) => s.loadHiddenHistory);
  const hiddenHistory = usePlayStore((s) => s.hiddenHistory);
  const hiddenCount = usePlayStore((s) => s.hiddenCount);
  const decks = useDecksStore((s) => s.decks);
  // Dropping a row is asked about first: removal is permanent, and even a
  // hide is worth naming so nobody thinks they just deleted a shared record.
  const [pendingDrop, setPendingDrop] = useState<GameRecord[] | null>(null);
  const [editing, setEditing] = useState<GameRecord | null>(null);
  // Selection is opt-in: a permanent checkbox column would put a control in
  // front of every row of a list people mostly come here to read.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [showHidden, setShowHidden] = useState(false);
  const [loadingHidden, setLoadingHidden] = useState(false);
  // Both modes live in one list on purpose (one record per game, wherever it
  // was played); the filter is how you look at just one of them.
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const shown = useMemo(
    () => (filter === 'all' ? history : history.filter((r) => r.mode === filter)),
    [history, filter]
  );
  const deckRows = useMemo(() => aggregateDeckRecords(shown, userId), [shown, userId]);
  const matchupRows = useMemo(() => aggregateMatchupRecords(shown, userId), [shown, userId]);
  const hasBothModes =
    history.some((r) => r.mode === 'local') && history.some((r) => r.mode === 'online');
  const droppable = useMemo(() => shown.filter((r) => canDropRecord(r, userId)), [shown, userId]);
  const selectedRecords = useMemo(
    () => droppable.filter((r) => selected.has(r.id)),
    [droppable, selected]
  );

  const dropRecords = (records: GameRecord[]) => {
    for (const rec of records) {
      if (dropKind(rec, userId) === 'hide') void setHistoryHidden(rec.id, true);
      else removeHistory(rec.id);
    }
    setSelected(new Set());
    setSelecting(false);
  };

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const openHidden = async () => {
    const next = !showHidden;
    setShowHidden(next);
    if (!next || hiddenHistory.length > 0) return;
    setLoadingHidden(true);
    try {
      await loadHiddenHistory();
    } finally {
      setLoadingHidden(false);
    }
  };

  // Authed users always get the server-authoritative Friends leaderboard, even
  // before any games are recorded.
  if (history.length === 0 && userId === null) {
    return (
      <EmptyState
        tagline="No games yet."
        hint="Pick a door on the Play tab to start your first game."
      />
    );
  }

  return (
    <div className="play-history">
      {userId !== null && <FriendsLeaderboard />}
      {history.length === 0 && hiddenCount === 0 && (
        <EmptyState
          tagline="No games yet."
          hint="Pick a door on the Play tab to start your first game."
        />
      )}
      {hasBothModes && (
        <Tabs<HistoryFilter>
          ariaLabel="Which games"
          variant="fitted"
          className="play-history-filter"
          value={filter}
          onChange={setFilter}
          tabs={[
            { id: 'all', label: 'All games' },
            { id: 'local', label: 'Local' },
            { id: 'online', label: 'Online' },
          ]}
        />
      )}
      {deckRows.length > 0 && (
        <section className="play-records">
          <h2 className="play-records-title">Deck win-loss</h2>
          <table className="play-records-table">
            <thead>
              <tr>
                <th scope="col">Deck</th>
                <th scope="col">Played</th>
                <th scope="col">W</th>
                <th scope="col">L</th>
                <th scope="col">Win %</th>
                <th scope="col">Last played</th>
              </tr>
            </thead>
            <tbody>
              {deckRows.map((row) => (
                <tr key={row.deckId}>
                  <td>{row.deckName}</td>
                  <td>{row.played}</td>
                  <td>{row.wins}</td>
                  <td>{row.losses}</td>
                  <td>{(row.winRate * 100).toFixed(0)}%</td>
                  <td>{new Date(row.lastPlayedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {matchupRows.length > 0 && (
        <section className="play-records">
          <h2 className="play-records-title">Head-to-head</h2>
          <table className="play-records-table">
            <thead>
              <tr>
                <th scope="col">Deck A</th>
                <th scope="col" className="play-matchup-vs">
                  vs
                </th>
                <th scope="col">Deck B</th>
                <th scope="col">Played</th>
                <th scope="col">W</th>
                <th scope="col">L</th>
                <th scope="col">W/L</th>
                <th scope="col">Win%</th>
                <th scope="col">Last played</th>
              </tr>
            </thead>
            <tbody>
              {matchupRows.map((row) => (
                <tr key={`${row.deckAId}|${row.deckBId}`}>
                  <td>{row.deckAName}</td>
                  <td className="play-matchup-vs">vs</td>
                  <td>{row.deckBName}</td>
                  <td>{row.played}</td>
                  <td>{row.wins}</td>
                  <td>{row.losses}</td>
                  <td className="play-matchup-bar">
                    <StackedBar
                      segments={[
                        { key: 'w', value: row.wins, color: 'var(--success)' },
                        { key: 'l', value: row.losses, color: 'var(--err-text)' },
                      ]}
                      max={row.played}
                    />
                  </td>
                  <td>{(row.winRate * 100).toFixed(0)}%</td>
                  <td>{new Date(row.lastPlayedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <section className="play-records">
        <div className="play-records-head">
          <h2 className="play-records-title">Games</h2>
          {droppable.length > 0 && (
            <button
              type="button"
              className="play-history-select-toggle"
              aria-pressed={selecting}
              onClick={() => {
                setSelecting((on) => !on);
                setSelected(new Set());
              }}
            >
              {selecting ? 'Done' : 'Select'}
            </button>
          )}
        </div>
        {selecting && (
          <div className="play-history-bulk">
            <span className="play-history-bulk-count" aria-live="polite">
              {selected.size} selected
            </span>
            <button
              type="button"
              className="play-history-select-toggle"
              onClick={() =>
                setSelected(
                  selected.size === droppable.length
                    ? new Set()
                    : new Set(droppable.map((r) => r.id))
                )
              }
            >
              {selected.size === droppable.length ? 'Clear' : 'Select all'}
            </button>
            <Button
              variant="danger"
              disabled={selectedRecords.length === 0}
              onClick={() => setPendingDrop(selectedRecords)}
              className="play-history-bulk-drop"
            >
              Remove
            </Button>
          </div>
        )}
        {shown.length === 0 && history.length > 0 && (
          <EmptyState compact className="empty-state-hint">
            No {filter} games yet.
          </EmptyState>
        )}
        <ul className="play-history-list">
          {shown.map((rec) => {
            const winner =
              rec.winnerSeat != null ? rec.players.find((p) => p.seat === rec.winnerSeat) : null;
            const when = new Date(rec.endedAt).toLocaleString();
            const kind = dropKind(rec, userId);
            // Delete is a visible control, not a menu entry. It used to be one
            // and moving it behind the kebab made it unfindable — the first
            // question asked of this screen was "where is the option to
            // outright delete games?". Hiding stays in the menu: it is the
            // quieter, reversible one.
            const menuItems: OverflowMenuItem[] = [];
            if (ownsRecord(rec, userId)) {
              menuItems.push({ label: 'Correct this game', onClick: () => setEditing(rec) });
            }
            if (canHideRecord(rec, userId)) {
              menuItems.push({
                label: 'Hide from my list',
                onClick: () => setPendingDrop([rec]),
              });
            }
            return (
              <li key={rec.id} className="play-history-item">
                <div className="play-history-head">
                  {selecting && canDropRecord(rec, userId) && (
                    <input
                      type="checkbox"
                      className="play-history-check"
                      checked={selected.has(rec.id)}
                      aria-label={`Select game: ${when}`}
                      onChange={() => toggleSelected(rec.id)}
                    />
                  )}
                  <span className="play-history-format">{rec.format}</span>
                  <span className="play-history-mode">{rec.mode}</span>
                  <span className="play-history-date">{when}</span>
                  <Button
                    placement="row"
                    aria-label={`Rematch: ${when}`}
                    onClick={() => onRematch(rec)}
                  >
                    Rematch
                  </Button>
                  {menuItems.length > 0 && (
                    <OverflowMenu
                      items={menuItems}
                      ariaLabel={`Game options: ${when}`}
                      contextHost=".play-history-item"
                    />
                  )}
                  {kind === 'remove' && canDropRecord(rec, userId) && (
                    <IconButton
                      className="play-history-remove"
                      label={`Remove game: ${when}`}
                      onClick={() => setPendingDrop([rec])}
                      icon={<X width={14} height={14} strokeWidth={1.8} />}
                    />
                  )}
                </div>
                <div className="play-history-winner">
                  {coopResultLabel(rec) ??
                    (winner ? `Winner: ${winner.name}` : 'No winner recorded')}
                  {rec.durationMs > 0 && (
                    <span className="play-history-duration">
                      {' '}
                      · {Math.round(rec.durationMs / 60000)} min
                    </span>
                  )}
                </div>
                <ol className="play-history-players">
                  {rec.players.map((p) => (
                    <li key={p.seat} className={p.seat === rec.winnerSeat ? 'is-winner' : ''}>
                      <span className="play-history-player-name">{p.name}</span>
                      {p.deckName && <span className="play-history-player-deck">{p.deckName}</span>}
                      <span className="play-history-player-life">
                        {p.finalLife} life {p.eliminated ? '· eliminated' : ''}
                      </span>
                    </li>
                  ))}
                </ol>
              </li>
            );
          })}
        </ul>
      </section>
      {hiddenCount > 0 && (
        <section className="play-records">
          <button
            type="button"
            className="play-history-hidden-toggle"
            aria-expanded={showHidden}
            onClick={() => void openHidden()}
          >
            {hiddenCount} hidden {hiddenCount === 1 ? 'game' : 'games'}
          </button>
          {showHidden && (
            <>
              <p className="play-history-hidden-note">
                Out of your list only. Each one still counts in your win-loss.
              </p>
              {loadingHidden && hiddenHistory.length === 0 && (
                <EmptyState compact className="empty-state-hint">
                  Loading…
                </EmptyState>
              )}
              <ul className="play-history-list">
                {hiddenHistory.map((rec) => (
                  <li key={rec.id} className="play-history-item is-hidden-row">
                    <div className="play-history-head">
                      <span className="play-history-format">{rec.format}</span>
                      <span className="play-history-mode">{rec.mode}</span>
                      <span className="play-history-date">
                        {new Date(rec.endedAt).toLocaleString()}
                      </span>
                      <Button placement="row" onClick={() => void setHistoryHidden(rec.id, false)}>
                        Bring back
                      </Button>
                    </div>
                    <div className="play-history-winner">
                      {rec.players.map((p) => p.name).join(' · ')}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      {editing && (
        <GameResultEditDialog
          record={editing}
          decks={decks}
          onCancel={() => setEditing(null)}
          onSave={(edit) => {
            void editHistory(editing.id, edit);
            setEditing(null);
          }}
        />
      )}
      {pendingDrop && (
        <ConfirmDialog
          title={
            pendingDrop.length === 1
              ? dropKind(pendingDrop[0], userId) === 'hide'
                ? 'Hide this game?'
                : 'Remove this game?'
              : `Clear ${pendingDrop.length} games?`
          }
          body={dropConfirmBody(pendingDrop, userId)}
          confirmLabel={
            pendingDrop.every((r) => dropKind(r, userId) === 'hide') ? 'Hide' : 'Remove'
          }
          danger={pendingDrop.some((r) => dropKind(r, userId) === 'remove')}
          onCancel={() => setPendingDrop(null)}
          onConfirm={() => {
            dropRecords(pendingDrop);
            setPendingDrop(null);
          }}
        />
      )}
    </div>
  );
}
