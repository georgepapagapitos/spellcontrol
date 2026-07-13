import { useEffect, useMemo, useState } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';
import { fetchPrintings, getSetMap, type SetMap } from '../lib/api';
import { formatMoney } from '../lib/format-money';
import type { ChangeOwnership } from '../lib/deck-change';
import type { Condition, Finish } from '../types';
import { Modal } from './Modal';
import { SearchPill } from './SearchPill';
import { SelectMenu } from './SelectMenu';
import { CONDITION_OPTIONS, LANGUAGE_OPTIONS } from './PrintingPicker';

/** True when a printing's availability means the user owns at least one copy. */
function isOwnedAvailability(a: ChangeOwnership): boolean {
  return a === 'owned' || a === 'in-other-deck' || a === 'in-cube';
}

/** Sort key: free-to-bind first, then owned-but-elsewhere, then unowned. */
function availabilityRank(a: ChangeOwnership): number {
  if (a === 'owned') return 0;
  if (a === 'in-other-deck' || a === 'in-cube') return 1;
  return 2;
}

const AVAILABILITY_BADGE: Record<
  'owned' | 'in-other-deck' | 'in-cube',
  { label: string; className: string }
> = {
  owned: { label: 'Available', className: 'is-available' },
  'in-other-deck': { label: 'In a deck', className: 'is-in-deck' },
  'in-cube': { label: 'In a cube', className: 'is-in-cube' },
};

/** Per-copy inventory details (condition/language/flags). A missing key means "not set". */
export interface CardDetails {
  condition?: Condition;
  language?: string;
  /** Physical card has custom/altered art. */
  altered?: boolean;
  /** Copy is a proxy rather than a real printing. */
  proxy?: boolean;
  /** Physical card is a misprint. */
  misprint?: boolean;
}

type CardFlag = 'altered' | 'proxy' | 'misprint';

const FLAG_OPTIONS: { key: CardFlag; label: string }[] = [
  { key: 'altered', label: 'Altered' },
  { key: 'proxy', label: 'Proxy' },
  { key: 'misprint', label: 'Misprint' },
];

export interface PrintingSelection {
  card: ScryfallCard;
  finish: Finish;
  quantity?: number;
  /**
   * Present only when the dialog ran with the `details` prop. Missing
   * condition/language/flag keys mean the user cleared (or never set) that
   * field — appliers should overwrite, not merge.
   *
   * `conditionTouched`/`languageTouched` are only ever sent `false` — and only
   * when the corresponding `mixedDetails` field was set — meaning the user
   * left that field at its "Mixed" placeholder. Absent (or `true`) tells the
   * applier to write the field across the whole stack, same as before mixed
   * detection existed.
   */
  details?: CardDetails & { conditionTouched?: boolean; languageTouched?: boolean };
}

interface Props {
  cardName: string;
  currentScryfallId: string;
  currentFinish: Finish;
  /** When set, shows a quantity editor. Only used for grouped collection edits. */
  quantity?: number;
  /**
   * Ungrouped "All copies" edit: the change applies to a single physical copy,
   * not the whole printing stack. Hides the quantity editor (you're editing one
   * copy) and shows a note so it's clear siblings stay on the old printing.
   */
  singleCopy?: boolean;
  /**
   * Per-printing ownership for the deck-editor picker: marks which printings the
   * user already owns (and whether a copy is free to bind), floats owned ones to
   * the top, and enables the "Owned only" filter. Omitted by the collection/
   * binder callers, where every printing is being edited as owned inventory.
   */
  resolveAvailability?: (printing: ScryfallCard) => ChangeOwnership;
  /**
   * Which finishes of a printing the user owns and can bind here (deck-editor
   * picker). Drives the owned dot on the finish buttons + NF/F/E tags, makes
   * selecting an owned printing default to a finish you own, and — with
   * "Owned only" on — restricts the finish choice to owned finishes. Omit
   * where finish is free inventory input (collection/binder edits).
   */
  resolveOwnedFinishes?: (printing: ScryfallCard) => Finish[];
  /**
   * Current per-copy details. Presence enables the condition/language
   * editors (collection/binder inventory edits); omit for deck-slot and
   * list-entry callers where those fields don't apply. When the stack being
   * edited is grouped, this is the *representative* (first-seen) copy's
   * values — see `mixedDetails` for when that representative value would be
   * misleading to pre-fill.
   */
  details?: CardDetails;
  /**
   * Set only for a grouped stack whose condition and/or language actually
   * disagree across copies (e.g. `{ condition: '3 NM, 1 HP' }`). A field
   * present here renders as a "Mixed (…)" placeholder instead of pre-filling
   * `details`'s value, and is left untouched — preserving each copy's own
   * value — unless the user actively picks something. Omit (or leave a key
   * out) for a uniform stack or a single-copy edit; behavior there is
   * unchanged from before mixed detection existed.
   */
  mixedDetails?: { condition?: string; language?: string };
  onConfirm: (selection: PrintingSelection) => void;
  onCancel: () => void;
}

/** Sentinel select value for a mixed field the user hasn't touched yet — never a real condition/language code, so it matches no option and the trigger falls back to the "Mixed (…)" placeholder. */
const MIXED = '__mixed__';

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
  singleCopy,
  resolveAvailability,
  resolveOwnedFinishes,
  details,
  mixedDetails,
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
  // '' = "not set" (mirrors CONDITION_OPTIONS / LANGUAGE_OPTIONS sentinels).
  // A mixed field starts at the MIXED sentinel instead of the representative
  // copy's value — silently pre-filling one copy's condition/language across
  // a stack that disagrees is exactly the homogenization this prop exists to
  // prevent.
  const conditionMixed = !!mixedDetails?.condition;
  const languageMixed = !!mixedDetails?.language;
  const [condition, setCondition] = useState<string>(
    conditionMixed ? MIXED : (details?.condition ?? '')
  );
  const [language, setLanguage] = useState<string>(
    languageMixed ? MIXED : (details?.language ?? '')
  );
  const [flags, setFlags] = useState<Record<CardFlag, boolean>>({
    altered: details?.altered ?? false,
    proxy: details?.proxy ?? false,
    misprint: details?.misprint ?? false,
  });
  const [search, setSearch] = useState('');
  const [ownedOnly, setOwnedOnly] = useState(false);

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

  const hasAnyOwned = useMemo(
    () =>
      resolveAvailability
        ? printings.some((c) => isOwnedAvailability(resolveAvailability(c)))
        : false,
    [printings, resolveAvailability]
  );

  const setGroups = useMemo(() => {
    let cards = printings;
    if (ownedOnly && resolveAvailability) {
      cards = cards.filter((c) => isOwnedAvailability(resolveAvailability(c)));
    }
    const groups = groupBySet(cards);
    if (resolveAvailability) {
      // Owned printings first within each set, then float any set that holds an
      // owned printing to the top — "show me what I already have" without
      // losing the set grouping. Array#sort is stable, so ties keep set order.
      for (const g of groups) {
        g.cards.sort(
          (a, b) =>
            availabilityRank(resolveAvailability(a)) - availabilityRank(resolveAvailability(b))
        );
      }
      groups.sort((ga, gb) => {
        const ra = ga.cards.some((c) => isOwnedAvailability(resolveAvailability(c))) ? 0 : 1;
        const rb = gb.cards.some((c) => isOwnedAvailability(resolveAvailability(c))) ? 0 : 1;
        return ra - rb;
      });
    }
    return groups;
  }, [printings, ownedOnly, resolveAvailability]);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return setGroups;
    return setGroups.filter(
      (g) => g.setName.toLowerCase().includes(q) || g.setCode.toLowerCase().includes(q)
    );
  }, [setGroups, search]);

  const shownCount = useMemo(
    () => filteredGroups.reduce((n, g) => n + g.cards.length, 0),
    [filteredGroups]
  );

  const selectedCard = printings.find((c) => c.id === selectedId) ?? null;
  const availableFinishes = useMemo<Finish[]>(() => {
    if (!selectedCard?.finishes || selectedCard.finishes.length === 0) return ['nonfoil'];
    return selectedCard.finishes.filter(
      (f: string): f is Finish => f === 'nonfoil' || f === 'foil' || f === 'etched'
    );
  }, [selectedCard]);

  // Finishes of the selected printing the user owns and can bind (empty when
  // the caller doesn't resolve ownership, e.g. collection/binder edits).
  const ownedFinishes = useMemo<Finish[]>(
    () => (selectedCard && resolveOwnedFinishes ? resolveOwnedFinishes(selectedCard) : []),
    [selectedCard, resolveOwnedFinishes]
  );
  // With "Owned only" on, the finish choice narrows to what you physically
  // have of this printing — no phantom Foil for a copy that isn't in the
  // binder. Without owned copies (or with the filter off) every printed
  // finish stays offered.
  const ownedOffered = availableFinishes.filter((f) => ownedFinishes.includes(f));
  const offeredFinishes = ownedOnly && ownedOffered.length > 0 ? ownedOffered : availableFinishes;

  // When the selected printing (or the offered-finish set) changes, re-derive
  // the finish: picking a printing you own defaults to a finish you own of it;
  // otherwise only reset when the current choice is no longer offered.
  // Compare-prev-during-render keeps this synchronous without an extra render
  // pass (effect-based version triggers the react-hooks/set-state-in-effect
  // lint rule).
  const finishesKey = `${selectedId}|${offeredFinishes.join(',')}`;
  const [prevFinishesKey, setPrevFinishesKey] = useState(finishesKey);
  if (prevFinishesKey !== finishesKey) {
    const printingChanged = prevFinishesKey.split('|')[0] !== selectedId;
    setPrevFinishesKey(finishesKey);
    if (printingChanged && ownedOffered.length > 0 && !ownedOffered.includes(selectedFinish)) {
      setSelectedFinish(ownedOffered[0]);
    } else if (offeredFinishes.length > 0 && !offeredFinishes.includes(selectedFinish)) {
      setSelectedFinish(offeredFinishes[0]);
    }
  }

  // For a mixed field there's no single "original" value to diff against —
  // any move off the MIXED placeholder (including explicitly picking "not
  // set") is itself the meaningful change. A uniform field keeps the old
  // diff-against-`details` check untouched.
  const conditionChanged = conditionMixed
    ? condition !== MIXED
    : condition !== (details?.condition ?? '');
  const languageChanged = languageMixed
    ? language !== MIXED
    : language !== (details?.language ?? '');

  const isDirty =
    selectedId !== currentScryfallId ||
    selectedFinish !== currentFinish ||
    (quantity !== undefined && qty !== quantity) ||
    (details !== undefined &&
      (conditionChanged ||
        languageChanged ||
        FLAG_OPTIONS.some(({ key }) => flags[key] !== (details[key] ?? false))));

  const handleConfirm = () => {
    if (!selectedCard) return;
    onConfirm({
      card: selectedCard,
      finish: selectedFinish,
      ...(quantity !== undefined ? { quantity: qty } : {}),
      ...(details !== undefined
        ? {
            details: {
              ...(condition && condition !== MIXED ? { condition: condition as Condition } : {}),
              ...(language && language !== MIXED ? { language } : {}),
              ...(flags.altered ? { altered: true } : {}),
              ...(flags.proxy ? { proxy: true } : {}),
              ...(flags.misprint ? { misprint: true } : {}),
              // Only ever sent when the field is mixed — a uniform field omits
              // these keys entirely, so buildEditedCards' `?? true` default
              // keeps its always-write behavior byte-identical to before.
              ...(conditionMixed ? { conditionTouched: conditionChanged } : {}),
              ...(languageMixed ? { languageTouched: languageChanged } : {}),
            },
          }
        : {}),
    });
  };

  return (
    <Modal
      onClose={onCancel}
      label={`${details !== undefined ? 'Edit card' : 'Edit printing'} — ${cardName}`}
      className="modal card-edit-dialog"
    >
      <div className="modal-header">
        <h2>{details !== undefined ? 'Edit card' : 'Edit printing'}</h2>
        <button type="button" className="modal-close" aria-label="Close" onClick={onCancel}>
          ×
        </button>
      </div>

      <div className="modal-body card-edit-body">
        {loading && <div className="card-edit-loading">Loading printings…</div>}
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

              {offeredFinishes.length > 1 && (
                <div className="card-edit-finishes" role="group" aria-label="Finish">
                  {offeredFinishes.map((f) => {
                    const label = f === 'nonfoil' ? 'Non-foil' : f === 'foil' ? 'Foil' : 'Etched';
                    const owned = ownedFinishes.includes(f);
                    return (
                      <button
                        key={f}
                        type="button"
                        className={`card-edit-finish-btn${selectedFinish === f ? ' is-active' : ''}${owned ? ' is-owned' : ''}`}
                        onClick={() => setSelectedFinish(f)}
                        aria-pressed={selectedFinish === f}
                        aria-label={owned ? `${label} — you own this finish` : label}
                      >
                        {label}
                        {owned && (
                          <span className="card-edit-finish-owned-dot" aria-hidden="true" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {details !== undefined && (
                <div className="card-edit-details">
                  <SelectMenu
                    label="Condition"
                    value={condition}
                    options={CONDITION_OPTIONS}
                    onChange={setCondition}
                    className="card-edit-details-select"
                    placeholder={conditionMixed ? `Mixed (${mixedDetails?.condition})` : undefined}
                  />
                  <SelectMenu
                    label="Language"
                    value={language}
                    options={LANGUAGE_OPTIONS}
                    onChange={setLanguage}
                    className="card-edit-details-select"
                    placeholder={languageMixed ? `Mixed (${mixedDetails?.language})` : undefined}
                  />
                  <div className="card-edit-finishes" role="group" aria-label="Card flags">
                    {FLAG_OPTIONS.map(({ key, label }) => (
                      <button
                        key={key}
                        type="button"
                        className={`card-edit-finish-btn${flags[key] ? ' is-active' : ''}`}
                        onClick={() => setFlags((f) => ({ ...f, [key]: !f[key] }))}
                        aria-pressed={flags[key]}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {singleCopy && (
                <p className="card-edit-single-note">
                  Editing one copy — other copies of this printing stay as they are.
                </p>
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
                <div className="card-edit-sets-header-left">
                  <span>
                    {shownCount} printing{shownCount === 1 ? '' : 's'} across{' '}
                    {filteredGroups.length} set{filteredGroups.length === 1 ? '' : 's'}
                  </span>
                  {hasAnyOwned && (
                    <button
                      type="button"
                      className="card-edit-owned-toggle"
                      aria-pressed={ownedOnly}
                      onClick={() => setOwnedOnly((v) => !v)}
                    >
                      Owned only
                    </button>
                  )}
                </div>
                <SearchPill
                  className="card-edit-set-search"
                  placeholder="Filter sets…"
                  value={search}
                  onChange={setSearch}
                  ariaLabel="Filter by set name or code"
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
                      const availability = resolveAvailability?.(card);
                      const availBadge =
                        availability && availability !== 'unowned'
                          ? AVAILABILITY_BADGE[availability]
                          : null;
                      const rowOwnedFinishes = resolveOwnedFinishes?.(card) ?? [];
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
                            {finishes.map((f) => {
                              const owned = rowOwnedFinishes.includes(f as Finish);
                              return (
                                <span
                                  key={f}
                                  className={`card-edit-finish-tag card-edit-finish-tag--${f}${owned ? ' is-owned' : ''}`}
                                >
                                  {f === 'nonfoil' ? 'NF' : f === 'foil' ? 'F' : 'E'}
                                  {owned && <span className="sr-only"> (owned)</span>}
                                </span>
                              );
                            })}
                          </span>
                          <span className="card-edit-printing-rarity">{card.rarity}</span>
                          <span className="card-edit-printing-price">
                            {formatMoney(price, { zeroAsDash: true })}
                          </span>
                          {availBadge && (
                            <span className={`card-edit-avail-badge ${availBadge.className}`}>
                              {availBadge.label}
                            </span>
                          )}
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
