import { useEffect, useMemo, useState } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';
import { fetchPrintings, getSetMap, type SetMap } from '../lib/api';
import { formatMoney } from '../lib/format-money';
import { Modal } from './Modal';

type Finish = 'nonfoil' | 'foil' | 'etched';

export interface PrintingSelection {
  card: ScryfallCard;
  finish: Finish;
  quantity?: number;
}

interface Props {
  cardName: string;
  currentScryfallId: string;
  currentFinish: Finish;
  /** When set, shows a quantity editor. Only used for collection edits. */
  quantity?: number;
  onConfirm: (selection: PrintingSelection) => void;
  onCancel: () => void;
}

function frontImage(card: ScryfallCard): string | undefined {
  return card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal;
}

function priceForFinish(card: ScryfallCard, finish: Finish): number {
  const p = card.prices;
  if (!p) return 0;
  const raw = finish === 'foil' ? p.usd_foil : finish === 'etched' ? p.usd_etched : p.usd;
  return raw ? Number(raw) || 0 : 0;
}

interface SetGroup {
  setCode: string;
  setName: string;
  cards: ScryfallCard[];
}

function groupBySet(cards: ScryfallCard[]): SetGroup[] {
  const map = new Map<string, SetGroup>();
  for (const c of cards) {
    const key = c.set.toUpperCase();
    let group = map.get(key);
    if (!group) {
      group = { setCode: key, setName: c.set_name, cards: [] };
      map.set(key, group);
    }
    group.cards.push(c);
  }
  return [...map.values()];
}

export function CardEditDialog({
  cardName,
  currentScryfallId,
  currentFinish,
  quantity,
  onConfirm,
  onCancel,
}: Props) {
  const [printings, setPrintings] = useState<ScryfallCard[]>([]);
  // `loadedFor` tracks which cardName the current `printings` belongs to.
  // Loading is derived as "loadedFor !== cardName" so we don't have to call
  // setLoading(true) synchronously inside the fetching effect.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setMap, setSetMap] = useState<SetMap | null>(null);

  const [selectedId, setSelectedId] = useState(currentScryfallId);
  const [selectedFinish, setSelectedFinish] = useState<Finish>(currentFinish);
  const [qty, setQty] = useState(quantity ?? 1);
  const [search, setSearch] = useState('');

  const loading = loadedFor !== cardName && error === null;

  useEffect(() => {
    let cancelled = false;
    fetchPrintings(cardName)
      .then((cards) => {
        if (cancelled) return;
        setPrintings(cards);
        setError(null);
        setLoadedFor(cardName);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load printings');
        setLoadedFor(cardName);
      });
    return () => {
      cancelled = true;
    };
  }, [cardName]);

  useEffect(() => {
    let cancelled = false;
    getSetMap()
      .then((m) => {
        if (!cancelled) setSetMap(m);
      })
      .catch(() => {
        /* set icons are decorative — silently skip on failure */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setGroups = useMemo(() => groupBySet(printings), [printings]);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return setGroups;
    return setGroups.filter(
      (g) => g.setName.toLowerCase().includes(q) || g.setCode.toLowerCase().includes(q)
    );
  }, [setGroups, search]);

  const selectedCard = printings.find((c) => c.id === selectedId) ?? null;
  const availableFinishes = useMemo<Finish[]>(() => {
    if (!selectedCard?.finishes || selectedCard.finishes.length === 0) return ['nonfoil'];
    return selectedCard.finishes.filter(
      (f: string): f is Finish => f === 'nonfoil' || f === 'foil' || f === 'etched'
    );
  }, [selectedCard]);

  // When the selected printing changes, reset the finish if the current
  // choice isn't offered. Compare-prev-during-render keeps this synchronous
  // without an extra render pass (effect-based version triggers the
  // react-hooks/set-state-in-effect lint rule).
  const [prevFinishesKey, setPrevFinishesKey] = useState(availableFinishes.join(','));
  const finishesKey = availableFinishes.join(',');
  if (prevFinishesKey !== finishesKey) {
    setPrevFinishesKey(finishesKey);
    if (availableFinishes.length > 0 && !availableFinishes.includes(selectedFinish)) {
      setSelectedFinish(availableFinishes[0]);
    }
  }

  const isDirty =
    selectedId !== currentScryfallId ||
    selectedFinish !== currentFinish ||
    (quantity !== undefined && qty !== quantity);

  const handleConfirm = () => {
    if (!selectedCard) return;
    onConfirm({
      card: selectedCard,
      finish: selectedFinish,
      ...(quantity !== undefined ? { quantity: qty } : {}),
    });
  };

  return (
    <Modal
      onClose={onCancel}
      label={`Edit printing for ${cardName}`}
      className="modal card-edit-dialog"
    >
      <div className="modal-header">
        <h2>Edit printing</h2>
        <button type="button" className="modal-close" aria-label="Close" onClick={onCancel}>
          ×
        </button>
      </div>

      <div className="modal-body card-edit-body">
        {loading && <div className="card-edit-loading">Loading printings...</div>}
        {error && <div className="card-edit-error">{error}</div>}

        {!loading && !error && (
          <div className="card-edit-layout">
            <div className="card-edit-preview">
              {selectedCard && frontImage(selectedCard) ? (
                <img
                  src={frontImage(selectedCard)}
                  alt={selectedCard.name}
                  className="card-edit-preview-img"
                />
              ) : (
                <div className="card-edit-preview-placeholder">{cardName}</div>
              )}
              {selectedCard && (
                <div className="card-edit-preview-info">
                  <span className="card-edit-preview-set">
                    {setMap?.[selectedCard.set.toUpperCase()]?.iconSvgUri && (
                      <img
                        src={setMap[selectedCard.set.toUpperCase()].iconSvgUri}
                        alt=""
                        aria-hidden
                        className="card-edit-set-icon"
                      />
                    )}
                    {selectedCard.set.toUpperCase()} #{selectedCard.collector_number}
                  </span>
                  <span className="card-edit-preview-price">
                    {formatMoney(priceForFinish(selectedCard, selectedFinish), {
                      zeroAsDash: true,
                    })}
                  </span>
                </div>
              )}

              {availableFinishes.length > 1 && (
                <div className="card-edit-finishes" role="group" aria-label="Finish">
                  {availableFinishes.map((f) => (
                    <button
                      key={f}
                      type="button"
                      className={`card-edit-finish-btn${selectedFinish === f ? ' is-active' : ''}`}
                      onClick={() => setSelectedFinish(f)}
                      aria-pressed={selectedFinish === f}
                    >
                      {f === 'nonfoil' ? 'Non-foil' : f === 'foil' ? 'Foil' : 'Etched'}
                    </button>
                  ))}
                </div>
              )}

              {quantity !== undefined && (
                <div className="card-edit-qty">
                  <label className="card-edit-qty-label">Quantity</label>
                  <div className="card-edit-qty-controls">
                    <button
                      type="button"
                      className="card-edit-qty-btn"
                      onClick={() => setQty((q) => Math.max(0, q - 1))}
                      aria-label="Decrease quantity"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      className="card-edit-qty-input"
                      min={0}
                      max={99}
                      value={qty}
                      onChange={(e) => {
                        const n = Math.floor(Number(e.target.value));
                        if (Number.isFinite(n)) setQty(Math.max(0, Math.min(99, n)));
                      }}
                      aria-label="Quantity"
                    />
                    <button
                      type="button"
                      className="card-edit-qty-btn"
                      onClick={() => setQty((q) => Math.min(99, q + 1))}
                      aria-label="Increase quantity"
                    >
                      +
                    </button>
                  </div>
                  {qty === 0 && (
                    <span className="card-edit-qty-warn">
                      This will remove the card from your collection
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="card-edit-sets">
              <div className="card-edit-sets-header">
                <span>
                  {printings.length} printing{printings.length === 1 ? '' : 's'} across{' '}
                  {setGroups.length} set{setGroups.length === 1 ? '' : 's'}
                </span>
                <input
                  type="search"
                  className="card-edit-set-search"
                  placeholder="Filter sets..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Filter by set name or code"
                />
              </div>
              <div className="card-edit-sets-list">
                {filteredGroups.length === 0 && (
                  <div className="card-edit-sets-empty">No sets match "{search}"</div>
                )}
                {filteredGroups.map((group) => (
                  <div key={group.setCode} className="card-edit-set-group">
                    <div className="card-edit-set-name">
                      {setMap?.[group.setCode]?.iconSvgUri && (
                        <img
                          src={setMap[group.setCode].iconSvgUri}
                          alt=""
                          aria-hidden
                          className="card-edit-set-icon"
                        />
                      )}
                      <span>{group.setName}</span>{' '}
                      <span className="card-edit-set-code">{group.setCode}</span>
                    </div>
                    {group.cards.map((card) => {
                      const active = card.id === selectedId;
                      const finishes: string[] = card.finishes ?? ['nonfoil'];
                      const price = priceForFinish(
                        card,
                        finishes.includes('nonfoil') ? 'nonfoil' : (finishes[0] as Finish)
                      );
                      return (
                        <button
                          key={card.id}
                          type="button"
                          className={`card-edit-printing-row${active ? ' is-active' : ''}${card.id === currentScryfallId ? ' is-current' : ''}`}
                          onClick={() => setSelectedId(card.id)}
                          aria-pressed={active}
                        >
                          <span className="card-edit-printing-num">#{card.collector_number}</span>
                          <span className="card-edit-printing-finishes">
                            {finishes.map((f) => (
                              <span
                                key={f}
                                className={`card-edit-finish-tag card-edit-finish-tag--${f}`}
                              >
                                {f === 'nonfoil' ? 'NF' : f === 'foil' ? 'F' : 'E'}
                              </span>
                            ))}
                          </span>
                          <span className="card-edit-printing-rarity">{card.rarity}</span>
                          <span className="card-edit-printing-price">
                            {formatMoney(price, { zeroAsDash: true })}
                          </span>
                          {card.id === currentScryfallId && (
                            <span className="card-edit-current-badge">current</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="modal-footer">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!isDirty || !selectedCard}
          onClick={handleConfirm}
        >
          Save
        </button>
      </div>
    </Modal>
  );
}
