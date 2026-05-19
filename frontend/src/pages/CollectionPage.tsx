import { BarChart3, Download, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useCollectionStore } from '../store/collection';
import { materializeBinders } from '../lib/materialize';
import { useAllocations } from '../lib/allocations';
import { useSetMap } from '../lib/api';
import { UploadPanel } from '../components/UploadPanel';
import { ImportSheet } from '../components/ImportSheet';
import { AddCardSheet } from '../components/AddCardSheet';
import { StatsBar } from '../components/StatsBar';
import { CardListTable } from '../components/CardListTable';

export function CollectionPage() {
  const cards = useCollectionStore((s) => s.cards);
  const binders = useCollectionStore((s) => s.binders);
  const subCollections = useCollectionStore((s) => s.subCollections);
  const hydrating = useCollectionStore((s) => s.hydrating);
  const error = useCollectionStore((s) => s.error);
  const setError = useCollectionStore((s) => s.setError);
  const setImportSheetOpen = useCollectionStore((s) => s.setImportSheetOpen);
  const [addCardOpen, setAddCardOpen] = useState(false);
  // '' = all, '__main' = Main (no id or an id that no longer resolves), else id
  const [subFilter, setSubFilter] = useState<string>('');

  const [statsOpen, setStatsOpen] = useState(false);

  const collectionCardCount = cards.length;
  const collectionValue = useMemo(
    () => cards.reduce((sum, c) => sum + c.purchasePrice, 0),
    [cards]
  );

  const allocations = useAllocations();
  const allocatedCopyIds = useMemo(() => new Set(allocations.keys()), [allocations]);
  const setMap = useSetMap();

  // Materialize without search — the collection table has its own local search.
  const { materialized } = useMemo(() => {
    if (cards.length === 0) return { materialized: [] };
    const result = materializeBinders(cards, binders, {
      search: '',
      allocatedCopyIds,
      setMap,
    });
    return { materialized: result.binders };
  }, [cards, binders, allocatedCopyIds, setMap]);

  // Sub-collection view filter. Scopes ONLY the list rendered in the table;
  // binder materialization above keeps reading the full `cards` array
  // (orthogonality — guarded by lib/materialize.test.ts).
  const validIds = useMemo(() => new Set(subCollections.map((d) => d.id)), [subCollections]);
  const countFor = (id: string | null) =>
    cards.filter((c) =>
      id === null
        ? !c.subCollectionId || !validIds.has(c.subCollectionId)
        : c.subCollectionId === id
    ).length;
  const visibleCards = useMemo(() => {
    if (subFilter === '') return cards;
    if (subFilter === '__main') {
      return cards.filter((c) => !c.subCollectionId || !validIds.has(c.subCollectionId));
    }
    return cards.filter((c) => c.subCollectionId === subFilter);
  }, [cards, subFilter, validIds]);

  return (
    <>
      {hydrating ? (
        <div className="page-loader" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <span className="visually-hidden">Loading</span>
        </div>
      ) : (
        <>
          {error && cards.length === 0 && (
            <div className="error-banner" style={{ marginBottom: '1rem' }}>
              {error}
              <button className="btn-link" style={{ marginLeft: 8 }} onClick={() => setError(null)}>
                Dismiss
              </button>
            </div>
          )}
          {cards.length === 0 && <UploadPanel />}
        </>
      )}

      {!hydrating && cards.length > 0 && (
        <>
          <header className="binder-hero collection-hero">
            <div className="collection-hero-text">
              <h1 className="binder-hero-name">Collection</h1>
              <p className="binder-hero-meta collection-hero-meta">
                <span aria-label="Collection totals">
                  {collectionCardCount.toLocaleString()}{' '}
                  {collectionCardCount === 1 ? 'card' : 'cards'} · ${collectionValue.toFixed(0)}
                </span>
                <span aria-hidden> · </span>
                <button
                  type="button"
                  className="collection-hero-stats-link"
                  onClick={() => setStatsOpen(true)}
                  aria-label="Open collection breakdown"
                  title="Breakdown"
                >
                  <BarChart3 width={12} height={12} strokeWidth={2} aria-hidden />
                  <span>Stats</span>
                </button>
              </p>
            </div>
            <div className="collection-hero-actions">
              <button
                type="button"
                className="pill-btn collection-hero-action"
                aria-haspopup="dialog"
                onClick={() => setAddCardOpen(true)}
              >
                <Plus width={14} height={14} strokeWidth={1.8} aria-hidden />
                <span>Add card</span>
              </button>
              <button
                type="button"
                className="pill-btn collection-hero-action"
                aria-haspopup="dialog"
                onClick={() => setImportSheetOpen(true)}
              >
                <Download width={14} height={14} strokeWidth={1.8} aria-hidden />
                <span>Import cards</span>
              </button>
            </div>
          </header>
          {subCollections.length > 0 && (
            <div
              className="collection-subfilter chip-group"
              role="group"
              aria-label="Sub-collection filter"
            >
              <button
                type="button"
                className={`chip${subFilter === '' ? ' active' : ''}`}
                aria-pressed={subFilter === ''}
                onClick={() => setSubFilter('')}
              >
                All ({cards.length})
              </button>
              <button
                type="button"
                className={`chip${subFilter === '__main' ? ' active' : ''}`}
                aria-pressed={subFilter === '__main'}
                onClick={() => setSubFilter('__main')}
              >
                Main ({countFor(null)})
              </button>
              {subCollections.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`chip${subFilter === s.id ? ' active' : ''}`}
                  aria-pressed={subFilter === s.id}
                  onClick={() => setSubFilter(s.id)}
                >
                  {s.name} ({countFor(s.id)})
                </button>
              ))}
            </div>
          )}
          <CardListTable cards={visibleCards} binders={materialized} setMap={setMap} />
          <StatsBar open={statsOpen} onClose={() => setStatsOpen(false)} />
          <ImportSheet />
          {addCardOpen && <AddCardSheet onClose={() => setAddCardOpen(false)} />}
        </>
      )}
    </>
  );
}
