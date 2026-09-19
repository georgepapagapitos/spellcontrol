import { logger } from '@/lib/logger';
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
// Admin + scanner sheet: shared with YouPage and CardScanner, off the boot payload (E265).
import '@/styles/admin-scanner.css';
import { useAuth } from '../store/auth';
import { useCollectionStore } from '../store/collection';
import { AdminPanel } from '../components/AdminPanel';
import { useConfirm } from '../lib/use-confirm';
import { stopSyncAndWipeLocal } from '../lib/sync';
import { Tabs } from '../components/Tabs';
import { useDecksStore, type Deck } from '../store/decks';
import {
  buildAllocationMap,
  findSuboptimalPrintings,
  useCollectionByCopyId,
} from '../lib/allocations';
import type { EnrichedCard } from '../types';
import {
  listEvents,
  type BeaconRows,
  type ErrorCountRow,
  type EventCountRow,
  type VitalCountRow,
} from '../lib/admin-api';
import { formatRelativeTime } from '../lib/format-time';
import { userMessage } from '../lib/user-error';

type Tab = 'analytics' | 'users' | 'overview' | 'decks' | 'storage' | 'raw';

// Stable empty map for the brief pre-hydration window (keeps the prop a Map).
const EMPTY_COLLECTION: Map<string, EnrichedCard> = new Map();

/**
 * "Wipe everything": every local store the app writes, then a cold reload.
 * Goes through the sync layer's own wipe (entity rows, mutation queue, pull
 * cursor, in-memory stores) instead of guessing IndexedDB names — the old
 * `indexedDB.deleteDatabase('spellcontrol')` targeted a database that no
 * longer exists and silently wiped nothing.
 */
export async function wipeThisDevice(): Promise<void> {
  await stopSyncAndWipeLocal();
  localStorage.clear();
  location.reload();
}

export function AdminPage() {
  // Destructive debug actions go through the shared confirm dialog, never
  // window.confirm (STYLE_GUIDE § Overlays).
  const { confirm, dialog: confirmDialog } = useConfirm();
  const isAdmin = useAuth((s) => s.user?.role === 'admin');
  const userId = useAuth((s) => s.user?.id ?? null);
  const cards = useCollectionStore((s) => s.cards);
  const hydrating = useCollectionStore((s) => s.hydrating);
  const binders = useCollectionStore((s) => s.binders);
  const importHistory = useCollectionStore((s) => s.importHistory);
  const fileName = useCollectionStore((s) => s.fileName);
  const uploadedAt = useCollectionStore((s) => s.uploadedAt);
  const clearCards = useCollectionStore((s) => s.clearCards);
  const deleteAllBinders = useCollectionStore((s) => s.deleteAllBinders);
  const decks = useDecksStore((s) => s.decks);
  const deleteAllDecks = useDecksStore((s) => s.deleteAllDecks);
  const remapAllocations = useDecksStore((s) => s.remapAllocations);

  const [tab, setTab] = useState<Tab>('analytics');
  // First-party beacon counters (lib/analytics + /api/admin/events), fetched
  // once when the tab is first opened. null = not loaded yet.
  const [events, setEvents] = useState<BeaconRows | null>(null);
  const [eventsError, setEventsError] = useState<string | null>(null);
  // Bumped by Retry so the effect re-runs (mirrors AdminPanel's reload keys).
  const [eventsReloadKey, setEventsReloadKey] = useState(0);
  useEffect(() => {
    if (tab !== 'analytics' || events !== null) return;
    listEvents(30)
      .then((rows) => {
        setEvents(rows);
        setEventsError(null);
      })
      .catch((err) => setEventsError(userMessage(err, "Couldn't load the usage counters.")));
  }, [tab, events, eventsReloadKey]);
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);

  // Shared hydration-aware index (undefined while the store hydrates → empty map).
  const collectionByCopyId = useCollectionByCopyId() ?? EMPTY_COLLECTION;

  const cardsByName = useMemo(() => {
    const m = new Map<string, EnrichedCard[]>();
    for (const c of cards) {
      const list = m.get(c.name) ?? [];
      list.push(c);
      m.set(c.name, list);
    }
    return m;
  }, [cards]);

  // doubleClaimCount comes from buildAllocationMap's own collision callback
  // (E133) rather than a separate scan — prod-visible where before this
  // invariant was only checkable via a dev-only console warning.
  const { allocationMap, doubleClaimCount } = useMemo(() => {
    let collisions = 0;
    const map = buildAllocationMap(decks, undefined, () => {
      collisions++;
    });
    return { allocationMap: map, doubleClaimCount: collisions };
  }, [decks]);

  // Slots bound to a wrong printing when the preferred printing is owned.
  // Single highest-signal allocation bug class — every other audit (orphan,
  // double-claim, name mismatch) is covered by the existing rows above.
  const suboptimalPrintings = useMemo(
    () => (hydrating ? [] : findSuboptimalPrintings(decks, cards)),
    [decks, cards, hydrating]
  );
  const fixableCount = useMemo(
    () => suboptimalPrintings.filter((r) => r.preferredFree).length,
    [suboptimalPrintings]
  );
  const stuckCount = suboptimalPrintings.length - fixableCount;
  const suboptimalGrouped = useMemo(() => {
    const m = new Map<
      string,
      {
        deckName: string;
        cardName: string;
        allocatedSet: string;
        count: number;
        fixable: boolean;
      }
    >();
    for (const r of suboptimalPrintings) {
      const k = `${r.deckId}|${r.cardName}|${r.preferredScryfallId}|${r.allocatedSet}`;
      const prev = m.get(k);
      if (prev) prev.count++;
      else
        m.set(k, {
          deckName: r.deckName,
          cardName: r.cardName,
          allocatedSet: r.allocatedSet,
          count: 1,
          fixable: r.preferredFree,
        });
    }
    return [...m.values()].sort((a, b) => b.count - a.count);
  }, [suboptimalPrintings]);
  const [remapResult, setRemapResult] = useState<string | null>(null);

  // Expose everything on window for console poking. Admin-only: never install
  // the debug helpers for a non-admin who somehow mounts this component.
  useEffect(() => {
    if (!isAdmin) return;
    type DebugWindow = Window & {
      __debug?: Record<string, unknown>;
    };
    const w = window as DebugWindow;
    w.__debug = {
      cards,
      decks,
      binders,
      allocationMap,
      collectionByCopyId,
      cardsByName,
      dumpDeck(query: string) {
        const lower = query.toLowerCase();
        const deck =
          decks.find((d) => d.id === query) ||
          decks.find((d) => d.name.toLowerCase().includes(lower));
        if (!deck) {
          logger.warn(`[debug] no deck matching "${query}"`);
          return null;
        }
        const rows = deck.cards.map((c) => {
          const copy = c.allocatedCopyId ? collectionByCopyId.get(c.allocatedCopyId) : undefined;
          return {
            slotName: c.card.name,
            slotScryfallId: c.card.id,
            allocatedCopyId: c.allocatedCopyId,
            allocatedCardName: copy?.name ?? null,
            allocatedSet: copy ? `${copy.setCode} #${copy.collectorNumber}` : null,
            allocatedFinish: copy?.finish ?? null,
            status: !c.allocatedCopyId ? 'unowned' : copy ? 'allocated' : 'orphan',
            nameMismatch: copy ? copy.name !== c.card.name : false,
          };
        });
        logger.table(rows);
        return { deck, rows };
      },
    };
    return () => {
      delete (window as DebugWindow).__debug;
    };
  }, [isAdmin, cards, decks, binders, allocationMap, collectionByCopyId, cardsByName]);

  const overview = useMemo(() => {
    const totalCopies = cards.length;
    const uniqueScryfallIds = new Set(cards.map((c) => c.scryfallId)).size;
    const uniqueNames = cardsByName.size;
    let allocated = 0;
    let orphan = 0;
    let nameMismatch = 0;
    let unowned = 0;
    for (const deck of decks) {
      const checkSlot = (slotName: string, allocatedCopyId: string | null) => {
        if (!allocatedCopyId) {
          unowned++;
          return;
        }
        const copy = collectionByCopyId.get(allocatedCopyId);
        if (!copy) orphan++;
        else {
          allocated++;
          if (copy.name !== slotName) nameMismatch++;
        }
      };
      if (deck.commander) checkSlot(deck.commander.name, deck.commanderAllocatedCopyId);
      if (deck.partnerCommander)
        checkSlot(deck.partnerCommander.name, deck.partnerCommanderAllocatedCopyId);
      for (const c of deck.cards) checkSlot(c.card.name, c.allocatedCopyId);
      for (const c of deck.sideboard ?? []) checkSlot(c.card.name, c.allocatedCopyId);
    }
    return {
      totalCopies,
      uniqueScryfallIds,
      uniqueNames,
      totalDecks: decks.length,
      totalBinders: binders.length,
      allocated,
      orphan,
      unowned,
      nameMismatch,
    };
  }, [cards, cardsByName, decks, binders, collectionByCopyId]);

  // Defense-in-depth behind the App.tsx route guard: bail for non-admins even
  // if another entry point mounts this page directly. Placed after all hooks
  // to respect the Rules of Hooks.
  if (!isAdmin) return <Navigate to="/collection" replace />;

  return (
    <div className="admin-page">
      {confirmDialog}
      <div className="admin-header">
        <h1>Admin</h1>
        <p className="admin-sub">
          Production signals and user controls first. The local tabs read this device&apos;s own
          stores, the same IndexedDB the app uses, and change nothing unless a button says so.
        </p>
        <p className="admin-sub">
          Console helpers: <code>window.__debug.dumpDeck("mono-white")</code>,{' '}
          <code>window.__debug.decks</code>, <code>window.__debug.allocationMap</code>.
        </p>
      </div>

      <Tabs
        ariaLabel="Admin sections"
        variant="scrollable"
        className="admin-tabs"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'analytics', label: 'Analytics' },
          { id: 'users', label: 'Users & reports' },
          { id: 'overview', label: 'Local checks' },
          { id: 'decks', label: 'Decks', count: decks.length },
          { id: 'storage', label: 'Local data' },
          { id: 'raw', label: 'Raw JSON' },
        ]}
      />

      {hydrating && <p className="admin-warn">Collection store still hydrating from IndexedDB…</p>}

      {tab === 'analytics' && (
        <AnalyticsTab
          events={events}
          error={eventsError}
          onRetry={() => {
            setEventsError(null);
            setEventsReloadKey((k) => k + 1);
          }}
        />
      )}

      {tab === 'users' && userId && (
        <section className="admin-section admin-section--cards">
          <AdminPanel currentUserId={userId} />
        </section>
      )}

      {tab === 'overview' && (
        <section className="admin-section">
          <h2>Snapshot</h2>
          <table className="admin-table">
            <tbody>
              <tr>
                <th>Total physical copies (collection)</th>
                <td>{overview.totalCopies.toLocaleString()}</td>
              </tr>
              <tr>
                <th>Unique scryfallIds (printings)</th>
                <td>{overview.uniqueScryfallIds.toLocaleString()}</td>
              </tr>
              <tr>
                <th>Unique card names</th>
                <td>{overview.uniqueNames.toLocaleString()}</td>
              </tr>
              <tr>
                <th>Decks</th>
                <td>{overview.totalDecks}</td>
              </tr>
              <tr>
                <th>Binders</th>
                <td>{overview.totalBinders}</td>
              </tr>
              <tr>
                <th>Deck slots: allocated</th>
                <td>{overview.allocated}</td>
              </tr>
              <tr>
                <th>Deck slots: unowned (no allocation)</th>
                <td>{overview.unowned}</td>
              </tr>
              <tr>
                <th>
                  Deck slots: <span className="admin-err">orphan</span> (pointed at copyId not in
                  collection)
                </th>
                <td className={overview.orphan ? 'admin-err' : ''}>{overview.orphan}</td>
              </tr>
              <tr>
                <th>
                  Deck slots: <span className="admin-err">name mismatch</span> (allocated copy name
                  ≠ slot name)
                </th>
                <td className={overview.nameMismatch ? 'admin-err' : ''}>
                  {overview.nameMismatch}
                </td>
              </tr>
              <tr>
                <th>
                  Deck slots:{' '}
                  <span className={doubleClaimCount ? 'admin-err' : ''}>double-claimed</span> (same
                  physical copy bound to &gt;1 slot, self-heals automatically. A nonzero count here
                  means it's happening faster than the heal)
                </th>
                <td className={doubleClaimCount ? 'admin-err' : ''}>{doubleClaimCount}</td>
              </tr>
              <tr>
                <th>
                  Deck slots:{' '}
                  <span className={fixableCount ? 'admin-err' : ''}>suboptimal printing</span> (a
                  free copy of the preferred printing exists → remap can rebind)
                </th>
                <td className={fixableCount ? 'admin-err' : ''}>
                  {fixableCount}
                  {stuckCount > 0 && (
                    <span className="admin-sub">
                      {' '}
                      (+{stuckCount} informational, not actionable)
                    </span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
          {(overview.orphan > 0 || overview.nameMismatch > 0 || doubleClaimCount > 0) && (
            <p className="admin-warn">
              Found {overview.orphan} orphan, {overview.nameMismatch} name-mismatched, and{' '}
              {doubleClaimCount} double-claimed allocation(s). Open the Decks tab to find them.
            </p>
          )}
          {fixableCount > 0 && (
            <>
              <p className="admin-warn">
                <strong>{fixableCount} slot(s) fixable</strong>: a free copy of the preferred
                printing exists, so re-running the remap rebinds them.
              </p>
              <div className="admin-danger" style={{ marginBottom: '0.85rem' }}>
                <button
                  onClick={() => {
                    const before = suboptimalPrintings.filter((r) => r.preferredFree).length;
                    remapAllocations(cards);
                    // decks store mutated synchronously — recompute against it.
                    const after = findSuboptimalPrintings(
                      useDecksStore.getState().decks,
                      cards
                    ).filter((r) => r.preferredFree).length;
                    const healed = before - after;
                    setRemapResult(
                      healed > 0
                        ? `Remap ran: ${healed} slot(s) healed, ${after} still fixable.`
                        : `Remap ran: nothing changed (${after} still fixable).`
                    );
                    setTimeout(() => setRemapResult(null), 6000);
                  }}
                >
                  Re-run allocation remap
                </button>
                {remapResult && <span className="admin-sub">{remapResult}</span>}
              </div>
              <table className="admin-table admin-table--dense">
                <thead>
                  <tr>
                    <th>Deck</th>
                    <th>Card</th>
                    <th>Got (set)</th>
                    <th>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {suboptimalGrouped
                    .filter((g) => g.fixable)
                    .slice(0, 25)
                    .map((g, i) => (
                      <tr key={i} className="admin-row--err">
                        <td>{g.deckName}</td>
                        <td>{g.cardName}</td>
                        <td className="admin-mono">{g.allocatedSet}</td>
                        <td>{g.count}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </>
          )}
          {stuckCount > 0 && (
            <details className="admin-subopt-info">
              <summary className="admin-sub">
                {stuckCount} slot(s) use a different printing than the generator&apos;s default.
                Informational, not a problem (click to expand)
              </summary>
              <p className="admin-sub">
                These slots are bound to a real owned copy. You also own the printing the generator
                happened to pick by default, but every copy of it is already in another deck.
                Nothing is broken, double-claimed, or orphaned. The only way to &quot;match&quot;
                would be to steal a copy out of another deck, which you don&apos;t want. Safe to
                ignore; listed for transparency.
              </p>
              <table className="admin-table admin-table--dense">
                <thead>
                  <tr>
                    <th>Deck</th>
                    <th>Card</th>
                    <th>Using (set)</th>
                    <th>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {suboptimalGrouped
                    .filter((g) => !g.fixable)
                    .slice(0, 50)
                    .map((g, i) => (
                      <tr key={i}>
                        <td>{g.deckName}</td>
                        <td>{g.cardName}</td>
                        <td className="admin-mono">{g.allocatedSet}</td>
                        <td>{g.count}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </details>
          )}
        </section>
      )}

      {tab === 'decks' && (
        <section className="admin-section">
          <h2>Decks</h2>
          <div className="admin-deck-layout">
            <ul className="admin-deck-list">
              {decks.map((d) => (
                <li key={d.id}>
                  <button
                    className={`admin-deck-link ${selectedDeckId === d.id ? 'is-active' : ''}`}
                    onClick={() => setSelectedDeckId(d.id)}
                  >
                    <span className="admin-deck-name">{d.name}</span>
                    <span className="admin-deck-meta">
                      {d.format} · {d.cards.length} cards
                    </span>
                  </button>
                </li>
              ))}
              {decks.length === 0 && <li className="admin-sub">No decks.</li>}
            </ul>
            <div className="admin-deck-detail">
              {selectedDeckId ? (
                <DeckDetail
                  deck={decks.find((d) => d.id === selectedDeckId)!}
                  collectionByCopyId={collectionByCopyId}
                  cardsByName={cardsByName}
                />
              ) : (
                <p className="admin-sub">Pick a deck on the left to inspect every slot.</p>
              )}
            </div>
          </div>
        </section>
      )}

      {tab === 'storage' && (
        <StorageTab
          fileName={fileName}
          uploadedAt={uploadedAt}
          importHistory={importHistory}
          onClearCards={async () => {
            const ok = await confirm({
              title: 'Clear the collection?',
              body: 'Every card in IndexedDB is removed. Decks and binders are kept.',
              confirmLabel: 'Clear collection',
              danger: true,
            });
            if (ok) void clearCards();
          }}
          onClearBinders={async () => {
            const ok = await confirm({
              title: 'Delete every binder?',
              body: 'Binder definitions are removed. Cards are untouched.',
              confirmLabel: 'Delete binders',
              danger: true,
            });
            if (ok) deleteAllBinders();
          }}
          onClearDecks={async () => {
            const ok = await confirm({
              title: `Delete all ${decks.length} ${decks.length === 1 ? 'deck' : 'decks'}?`,
              body: 'Collection and binders are kept.',
              confirmLabel: 'Delete decks',
              danger: true,
            });
            if (ok) deleteAllDecks();
          }}
          onNuke={async () => {
            const ok = await confirm({
              title: 'Wipe everything and reload?',
              body: 'Collection, decks, binders, unsent changes and local settings are all removed from this device. A signed-in account pulls everything back from the server on reload.',
              confirmLabel: 'Wipe everything',
              danger: true,
            });
            if (!ok) return;
            await wipeThisDevice();
          }}
          onRerunRemap={() => {
            remapAllocations(cards);
          }}
        />
      )}

      {tab === 'raw' && (
        <RawTab cards={cards} decks={decks} binders={binders} importHistory={importHistory} />
      )}

      <p className="admin-sub admin-footer-note">
        <Link to="/collection">← back to collection</Link>
      </p>
    </div>
  );
}

function DeckDetail({
  deck,
  collectionByCopyId,
  cardsByName,
}: {
  deck: Deck;
  collectionByCopyId: Map<string, EnrichedCard>;
  cardsByName: Map<string, EnrichedCard[]>;
}) {
  const rows = useMemo(() => {
    const slots: {
      zone: string;
      slotName: string;
      slotScryfallId: string;
      allocatedCopyId: string | null;
    }[] = [];
    if (deck.commander)
      slots.push({
        zone: 'commander',
        slotName: deck.commander.name,
        slotScryfallId: deck.commander.id,
        allocatedCopyId: deck.commanderAllocatedCopyId,
      });
    if (deck.partnerCommander)
      slots.push({
        zone: 'partner',
        slotName: deck.partnerCommander.name,
        slotScryfallId: deck.partnerCommander.id,
        allocatedCopyId: deck.partnerCommanderAllocatedCopyId,
      });
    for (const c of deck.cards)
      slots.push({
        zone: 'main',
        slotName: c.card.name,
        slotScryfallId: c.card.id,
        allocatedCopyId: c.allocatedCopyId,
      });
    for (const c of deck.sideboard ?? [])
      slots.push({
        zone: 'side',
        slotName: c.card.name,
        slotScryfallId: c.card.id,
        allocatedCopyId: c.allocatedCopyId,
      });
    return slots.map((s) => {
      const copy = s.allocatedCopyId ? collectionByCopyId.get(s.allocatedCopyId) : undefined;
      const status = !s.allocatedCopyId
        ? 'unowned'
        : copy
          ? copy.name !== s.slotName
            ? 'name-mismatch'
            : 'allocated'
          : 'orphan';
      return { ...s, copy, status, ownedCount: cardsByName.get(s.slotName)?.length ?? 0 };
    });
  }, [deck, collectionByCopyId, cardsByName]);

  const orphans = rows.filter((r) => r.status === 'orphan').length;
  const mismatches = rows.filter((r) => r.status === 'name-mismatch').length;
  const unowned = rows.filter((r) => r.status === 'unowned').length;

  return (
    <div>
      <h3>
        {deck.name} <span className="admin-sub">({deck.id})</span>
      </h3>
      <p className="admin-sub">
        {rows.length} total slots · {rows.length - orphans - mismatches - unowned} allocated ·{' '}
        {orphans} orphan · {mismatches} name-mismatch · {unowned} unowned
      </p>
      <table className="admin-table admin-table--dense">
        <thead>
          <tr>
            <th>Zone</th>
            <th>Slot name</th>
            <th>Slot scryfallId</th>
            <th>Allocated copyId</th>
            <th>Allocated card</th>
            <th>Set / #</th>
            <th>Finish</th>
            <th>Owned</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={i}
              className={
                r.status === 'orphan' || r.status === 'name-mismatch' ? 'admin-row--err' : ''
              }
            >
              <td>{r.zone}</td>
              <td>{r.slotName}</td>
              <td className="admin-mono">{r.slotScryfallId.slice(0, 8)}…</td>
              <td className="admin-mono">{r.allocatedCopyId?.slice(0, 8) ?? '—'}</td>
              <td>{r.copy?.name ?? '—'}</td>
              <td>{r.copy ? `${r.copy.setCode} #${r.copy.collectorNumber}` : '—'}</td>
              <td>{r.copy?.finish ?? '—'}</td>
              <td>{r.ownedCount}</td>
              <td>{r.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StorageTab({
  fileName,
  uploadedAt,
  importHistory,
  onClearCards,
  onClearBinders,
  onClearDecks,
  onNuke,
  onRerunRemap,
}: {
  fileName: string;
  uploadedAt: number | null;
  importHistory: { id: string; name: string; count: number; format: string; addedAt: number }[];
  onClearCards: () => void;
  onClearBinders: () => void;
  onClearDecks: () => void;
  onNuke: () => void;
  onRerunRemap: () => void;
}) {
  const [remapToast, setRemapToast] = useState<string | null>(null);

  return (
    <section className="admin-section">
      <h2>Local data</h2>
      <p className="admin-sub">
        Synced rows (cards, decks, binders) live in the per-row IndexedDB entity store with a
        durable mutation queue beside it; settings live in localStorage. Nothing here touches the
        server except through a normal sync.
      </p>
      <h3>Imports</h3>
      <p className="admin-sub">
        Most recent file: <code>{fileName || '(none)'}</code>{' '}
        {uploadedAt ? `at ${new Date(uploadedAt).toLocaleString()}` : ''}
      </p>
      <table className="admin-table admin-table--dense">
        <thead>
          <tr>
            <th>When</th>
            <th>Name</th>
            <th>Format</th>
            <th>Count</th>
            <th>Import id</th>
          </tr>
        </thead>
        <tbody>
          {importHistory.map((h) => (
            <tr key={h.id}>
              <td>{new Date(h.addedAt).toLocaleString()}</td>
              <td>{h.name}</td>
              <td>{h.format}</td>
              <td>{h.count}</td>
              <td className="admin-mono">{h.id.slice(0, 8)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Maintenance</h3>
      <p className="admin-sub">
        Re-runs the allocation remap against the current collection. Heals slots that drift from the
        user&apos;s owned printings (basic-land binding, orphaned copies, etc.) without needing a
        page refresh.
      </p>
      <div className="admin-danger">
        <button
          onClick={() => {
            onRerunRemap();
            setRemapToast('Remap complete.');
            setTimeout(() => setRemapToast(null), 2000);
          }}
        >
          Re-run allocation remap
        </button>
        {remapToast && <span className="admin-sub">{remapToast}</span>}
      </div>

      <h3 className="admin-danger-h">Danger zone</h3>
      <div className="admin-danger">
        <button onClick={onClearCards}>Clear collection</button>
        <button onClick={onClearBinders}>Delete all binders</button>
        <button onClick={onClearDecks}>Delete all decks</button>
        <button onClick={onNuke}>Wipe everything &amp; reload</button>
      </div>
    </section>
  );
}

function RawTab({
  cards,
  decks,
  binders,
  importHistory,
}: {
  cards: EnrichedCard[];
  decks: Deck[];
  binders: unknown[];
  importHistory: unknown[];
}) {
  const copy = (label: string, value: unknown) => {
    void navigator.clipboard.writeText(JSON.stringify(value, null, 2));
    logger.debug(`[admin] copied ${label}:`, value);
  };
  const download = (filename: string, value: unknown) => {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section className="admin-section">
      <h2>Raw JSON</h2>
      <p className="admin-sub">
        Copy or download the live store state. Console-logged on copy too, so you can paste into
        chat or just expand in DevTools.
      </p>
      <div className="admin-raw-actions">
        <button onClick={() => copy('decks', decks)}>Copy decks JSON</button>
        <button onClick={() => copy('binders', binders)}>Copy binders JSON</button>
        <button onClick={() => copy('importHistory', importHistory)}>Copy import history</button>
        <button onClick={() => download('collection.json', cards)}>
          Download collection.json ({cards.length} cards)
        </button>
        <button onClick={() => download('decks.json', decks)}>Download decks.json</button>
        <button onClick={() => download('binders.json', binders)}>Download binders.json</button>
      </div>
    </section>
  );
}

/** Sum `count` over rows grouped by `key`, sorted descending. */
function sumBy(rows: EventCountRow[], key: (r: EventCountRow) => string): [string, number][] {
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(key(r), (totals.get(key(r)) ?? 0) + r.count);
  return [...totals].sort((a, b) => b[1] - a[1]);
}

function CountTable({ caption, rows }: { caption: string; rows: [string, number][] }) {
  return (
    <table className="admin-table">
      <caption>{caption}</caption>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td colSpan={2}>Nothing counted yet.</td>
          </tr>
        )}
        {rows.map(([k, n]) => (
          <tr key={k}>
            <th>{k}</th>
            <td>{n.toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Last-30-day view of the first-party beacon: totals per event, page views
 * per (normalized) path, page views per day, then the two quality signals the
 * same beacon counts — client errors by (message, frame) and Core Web Vitals
 * by band. Aggregates client-side from the raw daily rows so the API stays
 * one trivial query per table.
 */
function AnalyticsTab({
  events,
  error,
  onRetry,
}: {
  events: BeaconRows | null;
  error: string | null;
  onRetry: () => void;
}) {
  if (error) {
    return (
      <p className="admin-warn" role="alert">
        {error}{' '}
        <button type="button" className="btn-link" onClick={onRetry}>
          Retry
        </button>
      </p>
    );
  }
  if (events === null) return <p className="admin-sub">Loading usage counters…</p>;
  const views = events.events.filter((r) => r.name === 'pageview');
  return (
    <section className="admin-section">
      <h2>Analytics (last 30 days)</h2>
      <p className="admin-sub">
        Aggregate counters only: a day, an event name, and a path. Nothing per person is stored.
      </p>
      <CountTable caption="Events" rows={sumBy(events.events, (r) => r.name)} />
      <CountTable caption="Page views by path" rows={sumBy(views, (r) => r.path).slice(0, 25)} />
      <CountTable
        caption="Page views by day"
        rows={sumBy(views, (r) => r.day).sort((a, b) => (a[0] < b[0] ? 1 : -1))}
      />
      <ErrorTable rows={events.errors} />
      <VitalsTable rows={events.vitals} />
    </section>
  );
}

/** Distinct client errors, summed across days, most frequent first. */
export function groupErrors(rows: ErrorCountRow[]): (ErrorCountRow & { days: number })[] {
  const m = new Map<string, ErrorCountRow & { days: number }>();
  for (const r of rows) {
    const k = `${r.kind}|${r.path}|${r.message}|${r.frame}`;
    const prev = m.get(k);
    if (prev) {
      prev.count += r.count;
      prev.days++;
      if (r.last_seen > prev.last_seen) prev.last_seen = r.last_seen;
    } else m.set(k, { ...r, days: 1 });
  }
  return [...m.values()].sort((a, b) => b.count - a.count);
}

function ErrorTable({ rows }: { rows: ErrorCountRow[] }) {
  const grouped = groupErrors(rows).slice(0, 50);
  const total = rows.reduce((n, r) => n + r.count, 0);
  return (
    <table className="admin-table admin-table--dense">
      <caption>
        Client errors ({total.toLocaleString()} in 30 days, {grouped.length} distinct)
      </caption>
      <thead>
        <tr>
          <th scope="col">Count</th>
          <th scope="col">Kind</th>
          <th scope="col">Path</th>
          <th scope="col">Message</th>
          <th scope="col">Frame</th>
          <th scope="col">Last seen</th>
        </tr>
      </thead>
      <tbody>
        {grouped.length === 0 && (
          <tr>
            <td colSpan={6}>No errors reported.</td>
          </tr>
        )}
        {grouped.map((r) => (
          <tr key={`${r.kind}|${r.path}|${r.message}|${r.frame}`}>
            <td>{r.count.toLocaleString()}</td>
            <td>{r.kind}</td>
            <td className="admin-mono">{r.path}</td>
            <td>{r.message}</td>
            <td className="admin-mono">{r.frame || '—'}</td>
            <td>{formatRelativeTime(new Date(r.last_seen).getTime())}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export interface VitalSummary {
  metric: VitalCountRow['metric'];
  path: string;
  samples: number;
  good: number;
  needs: number;
  poor: number;
  passes: boolean;
}

/**
 * One row per (metric, path): sample count, share in each band, and the p75
 * verdict — a metric passes at p75 when at least 75% of its samples are good,
 * which is the Core Web Vitals definition without storing a single timing.
 */
export function summarizeVitals(rows: VitalCountRow[]): VitalSummary[] {
  const m = new Map<string, VitalSummary>();
  for (const r of rows) {
    const k = `${r.metric}|${r.path}`;
    const row = m.get(k) ?? {
      metric: r.metric,
      path: r.path,
      samples: 0,
      good: 0,
      needs: 0,
      poor: 0,
      passes: false,
    };
    row.samples += r.count;
    if (r.rating === 'good') row.good += r.count;
    else if (r.rating === 'needs-improvement') row.needs += r.count;
    else row.poor += r.count;
    m.set(k, row);
  }
  const out = [...m.values()];
  for (const row of out) row.passes = row.good / row.samples >= 0.75;
  return out.sort(
    (a, b) =>
      Number(a.passes) - Number(b.passes) ||
      b.samples - a.samples ||
      a.metric.localeCompare(b.metric)
  );
}

function VitalsTable({ rows }: { rows: VitalCountRow[] }) {
  const summary = summarizeVitals(rows);
  const pct = (n: number, of: number) => `${Math.round((n / of) * 100)}%`;
  return (
    <table className="admin-table admin-table--dense">
      <caption>Web vitals by path (failing at p75 first)</caption>
      <thead>
        <tr>
          <th scope="col">Metric</th>
          <th scope="col">Path</th>
          <th scope="col">Samples</th>
          <th scope="col">Good</th>
          <th scope="col">Needs work</th>
          <th scope="col">Poor</th>
          <th scope="col">p75</th>
        </tr>
      </thead>
      <tbody>
        {summary.length === 0 && (
          <tr>
            <td colSpan={7}>No timings reported.</td>
          </tr>
        )}
        {summary.map((r) => (
          <tr key={`${r.metric}|${r.path}`} className={r.passes ? undefined : 'admin-row--err'}>
            <td>{r.metric}</td>
            <td className="admin-mono">{r.path}</td>
            <td>{r.samples.toLocaleString()}</td>
            <td>{pct(r.good, r.samples)}</td>
            <td>{pct(r.needs, r.samples)}</td>
            <td>{pct(r.poor, r.samples)}</td>
            <td>{r.passes ? 'Good' : <span className="admin-err">Failing</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
