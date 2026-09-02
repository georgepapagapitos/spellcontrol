import { useEffect, useMemo, useState } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';
import { fetchPrintings, getSetMap, type SetMap } from '../lib/api';
import { currencySymbol, useCurrency } from '../lib/currency';
import { formatMoney } from '../lib/format-money';
import type { ChangeOwnership } from '../lib/deck-change';
import type { Condition, Finish } from '../types';
import { Modal } from './Modal';
import { SearchPill } from './SearchPill';
import { SelectMenu } from './SelectMenu';
import { CONDITION_OPTIONS, LANGUAGE_OPTIONS } from './PrintingPicker';

import { userMessage } from '@/lib/user-error';
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
  /**
   * What the user paid for this copy — cost basis, NOT market value. Absent
   * means "not recorded", and so does 0 (`buildEditedCards` normalizes it away).
   * The applier stamps which display currency it was entered in.
   */
  acquiredPrice?: number;
  /**
   * Manual market-price override for this copy (E204) — for a printing
   * Scryfall prices wrong or not at all. Absent means "use market price", and
   * so does 0 (`buildEditedCards` normalizes it away, same as `acquiredPrice`).
   * Separate from `acquiredPrice`: this replaces market value everywhere it's
   * read; cost basis never does. The applier stamps which display currency it
   * was entered in.
   */
  priceOverride?: number;
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
   * `conditionTouched`/`languageTouched`/`acquiredPriceTouched`/`priceOverrideTouched`
   * are only ever sent `false` — and only when the corresponding `mixedDetails`
   * field was set — meaning the user left that field at its "Mixed" placeholder.
   * Absent (or `true`) tells the applier to write the field across the whole
   * stack, same as before mixed detection existed.
   */
  details?: CardDetails & {
    conditionTouched?: boolean;
    languageTouched?: boolean;
    acquiredPriceTouched?: boolean;
    priceOverrideTouched?: boolean;
  };
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
   * Set only for a grouped stack whose condition, language and/or cost basis
   * actually disagree across copies (e.g. `{ condition: '3 NM, 1 HP' }`). A
   * field present here renders as a "Mixed (…)" placeholder instead of
   * pre-filling `details`'s value, and is left untouched — preserving each
   * copy's own value — unless the user actively edits it. Omit (or leave a key
   * out) for a uniform stack or a single-copy edit; behavior there is
   * unchanged from before mixed detection existed.
   */
  mixedDetails?: {
    condition?: string;
    language?: string;
    acquiredPrice?: string;
    priceOverride?: string;
  };
  onConfirm: (selection: PrintingSelection) => void;
  onCancel: () => void;
}

/** Sentinel select value for a mixed field the user hasn't touched yet — never a real condition/language code, so it matches no option and the trigger falls back to the "Mixed (…)" placeholder. */
const MIXED = '__mixed__';

/** Ceiling for a typed money amount (cost basis or a price override) — above any real single-card price, and stops a fat-fingered paste from poisoning the roll-up/total. */
const MAX_MONEY = 1_000_000;

/**
 * Parse a typed money amount into storable cents-rounded money. Shared by the
 * cost-basis ("Paid") and market-override fields — both are "blank/garbage/
 * non-positive reads as not recorded" (`undefined`), matching
 * `EnrichedCard.acquiredPrice`/`priceOverride`, where zero is never a stored
 * value. Tolerates pasted currency symbols and thousands separators.
 */
function parseMoneyInput(raw: string): number | undefined {
  const cleaned = raw.replace(/[$€,\s]/g, '');
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(Math.round(n * 100) / 100, MAX_MONEY);
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
  // Raw text mirror of qty — lets the field go blank/mid-edit; the clamp only
  // runs at commit (blur/Enter), not on every keystroke. Resynced from qty
  // during render (not an effect — avoids react-hooks/set-state-in-effect)
  // whenever the stepper buttons change it.
  const [qtyText, setQtyText] = useState(String(quantity ?? 1));
  const [prevQty, setPrevQty] = useState(qty);
  if (prevQty !== qty) {
    setPrevQty(qty);
    setQtyText(String(qty));
  }
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
  // Cost basis. Text-mirrored like qty above (#1378): parsing/clamping happens
  // at commit (blur/Enter), never per keystroke, so a half-typed "12." isn't
  // rewritten under the cursor. A mixed stack starts blank behind a "Mixed (…)"
  // placeholder — pre-filling one copy's price across copies bought at
  // different times is exactly the homogenization mixedDetails prevents.
  const acquiredMixed = !!mixedDetails?.acquiredPrice;
  const initialPaidText =
    acquiredMixed || !details?.acquiredPrice ? '' : String(details.acquiredPrice);
  const [paidText, setPaidText] = useState(initialPaidText);
  // Market-price override (E204) — same text-mirror/commit-time-parse pattern
  // as cost basis above, including mixed-stack handling.
  const overrideMixed = !!mixedDetails?.priceOverride;
  const initialOverrideText =
    overrideMixed || !details?.priceOverride ? '' : String(details.priceOverride);
  const [overrideText, setOverrideText] = useState(initialOverrideText);
  const [search, setSearch] = useState('');
  const [ownedOnly, setOwnedOnly] = useState(false);
  // Which currency a typed cost basis gets stamped in (the applier reads the
  // same store) — surfaced on the field label so it's never ambiguous.
  const currency = useCurrency();

  const loading = loadedFor !== cardName && error === null;
  // Bumped by Retry so the printings effect re-runs for the same card name.
  const [reloadKey, setReloadKey] = useState(0);

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
        setError(userMessage(err, "Couldn't load other printings. Try again in a moment."));
        setLoadedFor(cardName);
      });
    return () => {
      cancelled = true;
    };
  }, [cardName, reloadKey]);

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
  // Compared numerically, so re-typing "4" as "4.00" isn't a change. On a mixed
  // stack any actual entry is the change (blank stays "leave each copy alone",
  // so a mixed stack can't be bulk-cleared from here — clear per copy in the
  // ungrouped view).
  const paid = parseMoneyInput(paidText);
  const acquiredChanged = acquiredMixed
    ? paidText.trim() !== ''
    : (paid ?? 0) !== (details?.acquiredPrice ?? 0);
  const override = parseMoneyInput(overrideText);
  const overrideChanged = overrideMixed
    ? overrideText.trim() !== ''
    : (override ?? 0) !== (details?.priceOverride ?? 0);

  const isDirty =
    selectedId !== currentScryfallId ||
    selectedFinish !== currentFinish ||
    (quantity !== undefined && qty !== quantity) ||
    (details !== undefined &&
      (conditionChanged ||
        languageChanged ||
        acquiredChanged ||
        overrideChanged ||
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
              ...(paid !== undefined ? { acquiredPrice: paid } : {}),
              ...(override !== undefined ? { priceOverride: override } : {}),
              // Only ever sent when the field is mixed — a uniform field omits
              // these keys entirely, so buildEditedCards' `?? true` default
              // keeps its always-write behavior byte-identical to before.
              ...(conditionMixed ? { conditionTouched: conditionChanged } : {}),
              ...(languageMixed ? { languageTouched: languageChanged } : {}),
              ...(acquiredMixed ? { acquiredPriceTouched: acquiredChanged } : {}),
              ...(overrideMixed ? { priceOverrideTouched: overrideChanged } : {}),
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
        {error && (
          <div className="card-edit-error" role="alert">
            {error}{' '}
            <button
              type="button"
              className="btn-link"
              onClick={() => {
                setError(null);
                setLoadedFor(null);
                setReloadKey((k) => k + 1);
              }}
            >
              Retry
            </button>
          </div>
        )}

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
                  <div className="card-edit-paid">
                    <label className="card-edit-paid-label" htmlFor="card-edit-paid-input">
                      Paid ({currencySymbol(currency)})
                    </label>
                    <input
                      id="card-edit-paid-input"
                      type="text"
                      inputMode="decimal"
                      className="card-edit-paid-input"
                      value={paidText}
                      placeholder={acquiredMixed ? `Mixed (${mixedDetails?.acquiredPrice})` : '—'}
                      onChange={(e) => setPaidText(e.target.value)}
                      // Normalize at commit, matching the quantity field: the
                      // stored value is what parseMoneyInput accepted, so the
                      // field can't sit showing "12abc" as if it saved.
                      onBlur={() => {
                        const n = parseMoneyInput(paidText);
                        setPaidText(n === undefined ? '' : String(n));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                      }}
                      aria-describedby="card-edit-paid-hint"
                    />
                    <span id="card-edit-paid-hint" className="card-edit-paid-hint">
                      What you paid per copy, in {currency}. Blank if you'd rather not track it.
                    </span>
                  </div>
                  <div className="card-edit-paid">
                    <label className="card-edit-paid-label" htmlFor="card-edit-override-input">
                      Market override ({currencySymbol(currency)})
                    </label>
                    <input
                      id="card-edit-override-input"
                      type="text"
                      inputMode="decimal"
                      className="card-edit-paid-input"
                      value={overrideText}
                      placeholder={overrideMixed ? `Mixed (${mixedDetails?.priceOverride})` : '—'}
                      onChange={(e) => setOverrideText(e.target.value)}
                      // Blank + Save clears it back to market price — same
                      // convention as the Paid field above, whose hint already
                      // establishes "blank means not set" in this dialog.
                      onBlur={() => {
                        const n = parseMoneyInput(overrideText);
                        setOverrideText(n === undefined ? '' : String(n));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                      }}
                      aria-describedby="card-edit-override-hint"
                    />
                    <span id="card-edit-override-hint" className="card-edit-paid-hint">
                      For a printing Scryfall prices wrong or not at all — replaces the market price
                      everywhere it's used (collection total, binder rules, filters). Leave blank to
                      use Scryfall's price.
                    </span>
                  </div>
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
                      value={qtyText}
                      onChange={(e) => setQtyText(e.target.value)}
                      onBlur={() => {
                        const n = Math.floor(Number(qtyText));
                        const next = Number.isFinite(n) ? Math.max(0, Math.min(99, n)) : 0;
                        setQty(next);
                        setQtyText(String(next));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
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
