import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCollectionStore } from '../store/collection';
import { useDecksStore, type Deck } from '../store/decks';
import { buildAllocationMap, findSuboptimalPrintings } from '../lib/allocations';
import type { EnrichedCard } from '../types';

type Tab = 'overview' | 'decks' | 'allocations' | 'collection' | 'binders' | 'storage' | 'raw';

export function AdminPage() {
  const cards = useCollectionStore((s) => s.cards);
  const hydrating = useCollectionStore((s) => s.hydrating);
  const binders = useCollectionStore((s) => s.binders);
  const importHistory = useCollectionStore((s) => s.importHistory);
  const fileName = useCollectionStore((s) => s.fileName);
  const uploadedAt = useCollectionStore((s) => s.uploadedAt);
  const clearCards = useCollectionStore((s) => s.clearCards);
  const deleteAllBinders = useCollectionStore((s) => s.deleteAllBinders);
  const decks = useDecksStore((s) => s.decks);

  const [tab, setTab] = useState<Tab>('overview');
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);

  const collectionByCopyId = useMemo(() => {
    const m = new Map<string, EnrichedCard>();
    for (const c of cards) m.set(c.copyId, c);
    return m;
  }, [cards]);

  const cardsByName = useMemo(() => {
    const m = new Map<string, EnrichedCard[]>();
    for (const c of cards) {
      const list = m.get(c.name) ?? [];
      list.push(c);
      m.set(c.name, list);
    }
    return m;
  }, [cards]);

  const allocationMap = useMemo(() => buildAllocationMap(decks), [decks]);

  // Slots bound to a wrong printing when the preferred printing is owned.
  // Single highest-signal allocation bug class — every other audit (orphan,
  // double-claim, name mismatch) is covered by the existing rows above.
  const suboptimalPrintings = useMemo(
    () => (hydrating ? [] : findSuboptimalPrintings(decks, cards)),
    [decks, cards, hydrating]
  );
  const suboptimalGrouped = useMemo(() => {
    const m = new Map<
      string,
      { deckName: string; cardName: string; allocatedSet: string; count: number }
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
        });
    }
    return [...m.values()].sort((a, b) => b.count - a.count);
  }, [suboptimalPrintings]);

  // Expose everything on window for console poking.
  useEffect(() => {
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
          console.warn(`[debug] no deck matching "${query}"`);
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
        console.table(rows);
        return { deck, rows };
      },
    };
    return () => {
      delete (window as DebugWindow).__debug;
    };
  }, [cards, decks, binders, allocationMap, collectionByCopyId, cardsByName]);

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

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1>Debug / Admin</h1>
        <p className="admin-sub">
          Live view of what is in localStorage + IndexedDB right now. Nothing here is persisted —
          this page just reads the same stores the rest of the app reads.
        </p>
        <p className="admin-sub">
          Console helpers: <code>window.__debug.dumpDeck("mono-white")</code>,{' '}
          <code>window.__debug.decks</code>, <code>window.__debug.allocationMap</code>.
        </p>
      </div>

      <nav className="admin-tabs">
        {(
          [
            ['overview', 'Overview'],
            ['decks', `Decks (${decks.length})`],
            ['allocations', `Allocations (${allocationMap.size})`],
            ['collection', `Collection (${cards.length})`],
            ['binders', `Binders (${binders.length})`],
            ['storage', 'Storage'],
            ['raw', 'Raw JSON'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            className={`admin-tab ${tab === k ? 'admin-tab--active' : ''}`}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </nav>

      {hydrating && <p className="admin-warn">Collection store still hydrating from IndexedDB…</p>}

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
                  Deck slots: <span className="admin-err">suboptimal printing</span> (bound to wrong
                  printing while the preferred printing is owned)
                </th>
                <td className={suboptimalPrintings.length ? 'admin-err' : ''}>
                  {suboptimalPrintings.length}
                </td>
              </tr>
            </tbody>
          </table>
          {(overview.orphan > 0 || overview.nameMismatch > 0) && (
            <p className="admin-warn">
              Found {overview.orphan} orphan and {overview.nameMismatch} name-mismatched
              allocations. Open the Decks tab to find them.
            </p>
          )}
          {suboptimalPrintings.length > 0 && (
            <>
              <p className="admin-warn">
                {suboptimalPrintings.length} slot(s) are bound to a wrong printing. A page refresh
                runs the allocation remap, which auto-heals these — if they persist after refresh,
                file a bug.
              </p>
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
                  {suboptimalGrouped.slice(0, 25).map((g, i) => (
                    <tr key={i} className="admin-row--err">
                      <td>{g.deckName}</td>
                      <td>{g.cardName}</td>
                      <td className="admin-mono">{g.allocatedSet}</td>
                      <td>{g.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {suboptimalGrouped.length > 25 && (
                <p className="admin-sub">…and {suboptimalGrouped.length - 25} more rows.</p>
              )}
            </>
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

      {tab === 'allocations' && (
        <AllocationsTab decks={decks} collectionByCopyId={collectionByCopyId} />
      )}

      {tab === 'collection' && (
        <CollectionTab cards={cards} cardsByName={cardsByName} allocationMap={allocationMap} />
      )}

      {tab === 'binders' && (
        <section className="admin-section">
          <h2>Binders</h2>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Mode</th>
                <th>Groups</th>
                <th>Pinned</th>
                <th>Excluded</th>
                <th>Manual order</th>
                <th>Hide alloc</th>
                <th>ID</th>
              </tr>
            </thead>
            <tbody>
              {binders.map((b) => (
                <tr key={b.id}>
                  <td>{b.name}</td>
                  <td>{b.mode ?? 'rules'}</td>
                  <td>{b.filterGroups.length}</td>
                  <td>{b.pinnedCopyIds?.length ?? 0}</td>
                  <td>{b.excludedCopyIds?.length ?? 0}</td>
                  <td>{b.manualOrder?.length ?? 0}</td>
                  <td>{b.hideDeckAllocated === false ? 'yes' : 'no'}</td>
                  <td className="admin-mono">{b.id.slice(0, 8)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'storage' && (
        <StorageTab
          fileName={fileName}
          uploadedAt={uploadedAt}
          importHistory={importHistory}
          onClearCards={() => {
            if (confirm('Wipe the entire collection from IndexedDB? Decks/binders are kept.'))
              void clearCards();
          }}
          onClearBinders={() => {
            if (confirm('Delete every binder definition? Cards untouched.')) deleteAllBinders();
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

function AllocationsTab({
  decks,
  collectionByCopyId,
}: {
  decks: Deck[];
  collectionByCopyId: Map<string, EnrichedCard>;
}) {
  const rows = useMemo(() => {
    type Row = {
      copyId: string;
      claimedBy: { deckId: string; deckName: string; slotName: string; zone: string }[];
      copy?: EnrichedCard;
    };
    const byCopyId = new Map<string, Row>();
    const record = (
      copyId: string | null,
      deckId: string,
      deckName: string,
      slotName: string,
      zone: string
    ) => {
      if (!copyId) return;
      const r = byCopyId.get(copyId) ?? {
        copyId,
        claimedBy: [],
        copy: collectionByCopyId.get(copyId),
      };
      r.claimedBy.push({ deckId, deckName, slotName, zone });
      byCopyId.set(copyId, r);
    };
    for (const deck of decks) {
      record(deck.commanderAllocatedCopyId, deck.id, deck.name, deck.commander?.name ?? '?', 'cmd');
      record(
        deck.partnerCommanderAllocatedCopyId,
        deck.id,
        deck.name,
        deck.partnerCommander?.name ?? '?',
        'partner'
      );
      for (const c of deck.cards)
        record(c.allocatedCopyId, deck.id, deck.name, c.card.name, 'main');
      for (const c of deck.sideboard ?? [])
        record(c.allocatedCopyId, deck.id, deck.name, c.card.name, 'side');
    }
    return [...byCopyId.values()].sort((a, b) => b.claimedBy.length - a.claimedBy.length);
  }, [decks, collectionByCopyId]);

  const multi = rows.filter((r) => r.claimedBy.length > 1);

  return (
    <section className="admin-section">
      <h2>Allocations ({rows.length} unique copyIds claimed)</h2>
      {multi.length > 0 && (
        <p className="admin-warn">
          {multi.length} copyId(s) claimed by more than one deck slot. The allocation map in the UI
          keeps only the LAST one (Map.set wins), so earlier claims silently disappear from the
          binder badge. Listed first below.
        </p>
      )}
      <table className="admin-table admin-table--dense">
        <thead>
          <tr>
            <th>copyId</th>
            <th>Card</th>
            <th>Set / #</th>
            <th>Finish</th>
            <th>Claimed by (deck · slot name · zone)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.copyId} className={r.claimedBy.length > 1 ? 'admin-row--err' : ''}>
              <td className="admin-mono">{r.copyId.slice(0, 8)}…</td>
              <td>{r.copy?.name ?? <span className="admin-err">missing from collection</span>}</td>
              <td>{r.copy ? `${r.copy.setCode} #${r.copy.collectorNumber}` : '—'}</td>
              <td>{r.copy?.finish ?? '—'}</td>
              <td>
                <ul className="admin-claim-list">
                  {r.claimedBy.map((c, i) => (
                    <li key={i}>
                      <strong>{c.deckName}</strong> → {c.slotName}{' '}
                      <span className="admin-sub">({c.zone})</span>
                    </li>
                  ))}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function CollectionTab({
  cards,
  cardsByName,
  allocationMap,
}: {
  cards: EnrichedCard[];
  cardsByName: Map<string, EnrichedCard[]>;
  allocationMap: Map<string, { deckName: string }>;
}) {
  const [filter, setFilter] = useState('');
  const byName = useMemo(() => {
    const rows = [...cardsByName.entries()].map(([name, copies]) => {
      const allocCount = copies.filter((c) => allocationMap.has(c.copyId)).length;
      const deckSet = new Set<string>();
      for (const c of copies) {
        const a = allocationMap.get(c.copyId);
        if (a) deckSet.add(a.deckName);
      }
      return {
        name,
        count: copies.length,
        allocated: allocCount,
        decks: [...deckSet],
      };
    });
    rows.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    return rows;
  }, [cardsByName, allocationMap]);

  const lower = filter.trim().toLowerCase();
  const filtered = lower ? byName.filter((r) => r.name.toLowerCase().includes(lower)) : byName;
  const shown = filtered.slice(0, 500);

  return (
    <section className="admin-section">
      <h2>
        Collection by name ({cards.length} physical copies, {cardsByName.size} unique names)
      </h2>
      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by card name…"
        className="admin-search"
      />
      <p className="admin-sub">
        Showing {shown.length} of {filtered.length} rows.
      </p>
      <table className="admin-table admin-table--dense">
        <thead>
          <tr>
            <th>Name</th>
            <th>Total copies</th>
            <th>Allocated to a deck</th>
            <th>Decks</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.name}>
              <td>{r.name}</td>
              <td>{r.count}</td>
              <td>{r.allocated}</td>
              <td>{r.decks.join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function StorageTab({
  fileName,
  uploadedAt,
  importHistory,
  onClearCards,
  onClearBinders,
}: {
  fileName: string;
  uploadedAt: number | null;
  importHistory: { id?: string; name: string; count: number; format: string; addedAt: number }[];
  onClearCards: () => void;
  onClearBinders: () => void;
}) {
  // Snapshot localStorage once at mount. Admin page is short-lived; no need
  // to re-read on every render or watch for storage events.
  const lsKeys = useMemo(() => {
    const out: { key: string; bytes: number }[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      const v = localStorage.getItem(k) ?? '';
      out.push({ key: k, bytes: v.length });
    }
    out.sort((a, b) => b.bytes - a.bytes);
    return out;
  }, []);

  return (
    <section className="admin-section">
      <h2>Storage</h2>
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
          {importHistory.map((h, i) => (
            <tr key={h.id ?? i}>
              <td>{new Date(h.addedAt).toLocaleString()}</td>
              <td>{h.name}</td>
              <td>{h.format}</td>
              <td>{h.count}</td>
              <td className="admin-mono">{h.id?.slice(0, 8) ?? '(legacy)'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>localStorage</h3>
      <table className="admin-table admin-table--dense">
        <thead>
          <tr>
            <th>Key</th>
            <th>Bytes</th>
          </tr>
        </thead>
        <tbody>
          {lsKeys.map((r) => (
            <tr key={r.key}>
              <td className="admin-mono">{r.key}</td>
              <td>{r.bytes.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="admin-sub">
        Collection lives in IndexedDB <code>spellcontrol/collection/current</code> (not shown
        above). Decks live in localStorage <code>mtg-decks</code>. Binders live in localStorage{' '}
        <code>spellcontrol</code>.
      </p>

      <h3 className="admin-danger-h">Danger zone</h3>
      <div className="admin-danger">
        <button onClick={onClearCards}>Clear collection (IndexedDB)</button>
        <button onClick={onClearBinders}>Delete all binders</button>
        <button
          onClick={() => {
            if (confirm('Nuke EVERYTHING (collection + decks + binders + localStorage)?')) {
              localStorage.clear();
              indexedDB.deleteDatabase('spellcontrol');
              location.reload();
            }
          }}
        >
          Nuke everything &amp; reload
        </button>
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
    console.log(`[admin] copied ${label}:`, value);
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
