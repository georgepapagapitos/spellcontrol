import './OptimizePanel.css';
import { useMemo, useState } from 'react';
import type { OptimizeCard, OptimizeSwaps } from '@/deck-builder/services/deckBuilder/deckAnalyzer';
import { useOptimizePlan, type OptimizeSide, type TriState } from './useOptimizePlan';
import { useCardCarousel } from './useCardCarousel';
import { OwnershipBadge } from './OwnershipBadge';

export interface OptimizePanelProps {
  swaps: OptimizeSwaps;
  /** Current deck card count — drives the projected-size math. */
  currentSize: number;
  /** Card names the player already owns — surfaces an "Owned" badge on adds. */
  ownedNames?: Set<string>;
  /** Commit the plan. Receives checked removal + addition names. */
  onApply: (removalNames: string[], additionNames: string[]) => void | Promise<void>;
  /** Disables the Apply button + checkboxes while a commit is in flight. */
  applying?: boolean;
}

/** Singular-format Commander deck size. Projected sizes above this warn. */
const MAX_DECK_SIZE = 99;

/** Role keys carry their own display labels on the card (roleLabel); this is
 *  the fallback used to humanize `excess:<role>` / `fills:<role>` when a card
 *  lacks roleLabel. Mirrors ROLE_LABELS_MAP in deckAnalyzer. */
const ROLE_LABELS: Record<string, string> = {
  ramp: 'Ramp',
  removal: 'Removal',
  boardwipe: 'Board Wipes',
  cardDraw: 'Card Advantage',
};

/** Static reasonCategory → section-label map for the keys deckAnalyzer emits
 *  directly (no dynamic suffix). Prefixed keys (excess:/fills:/curve:) and any
 *  unknown key fall through to humanizeCategory below. */
const CATEGORY_LABELS: Record<string, string> = {
  // removals
  tapland: 'Taplands',
  'excess-land': 'Excess Lands',
  'low-synergy': 'Low Synergy',
  'curve-fix': 'Curve Fix',
  'low-inclusion': 'Low Inclusion',
  balance: 'Balance to Deck Size',
  // additions
  'combo-enabler': 'Combo Enablers',
  'flex-land': 'Flex Lands',
  synergy: 'High Synergy',
  theme: 'Theme Synergy',
  'mana-fix': 'Land Recommendations',
  'color-fix': 'Color Fixing',
};

const CURVE_PHASE_LABELS: Record<string, string> = {
  early: 'Early Game Plays',
  mid: 'Mid Game Plays',
  late: 'Late Game Plays',
};

function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

/** Resolve a human section label for a group. The first card's `reason` is the
 *  documented fallback for unknown keys (deckAnalyzer always sets one). */
function humanizeCategory(category: string, fallbackReason: string): string {
  if (CATEGORY_LABELS[category]) return CATEGORY_LABELS[category];
  if (category.startsWith('excess:')) return `Excess ${roleLabel(category.slice(7))}`;
  if (category.startsWith('fills:')) return `Fills ${roleLabel(category.slice(6))} Gap`;
  if (category.startsWith('curve:')) {
    return CURVE_PHASE_LABELS[category.slice(6)] ?? 'Curve Fill';
  }
  return fallbackReason || category;
}

/** Same fallback chain as DeckAnalysisPanel.resolveThumb: provided imageUrl →
 *  Scryfall named-card image endpoint (CDN redirect, no JS API call). */
function resolveThumb(card: OptimizeCard): string {
  if (card.imageUrl) return card.imageUrl;
  return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(
    card.name
  )}&format=image&version=normal`;
}

interface CardGroup {
  category: string;
  label: string;
  cards: OptimizeCard[];
}

function groupByCategory(cards: OptimizeCard[]): CardGroup[] {
  const map = new Map<string, OptimizeCard[]>();
  for (const card of cards) {
    const bucket = map.get(card.reasonCategory);
    if (bucket) bucket.push(card);
    else map.set(card.reasonCategory, [card]);
  }
  return Array.from(map.entries()).map(([category, groupCards]) => ({
    category,
    label: humanizeCategory(category, groupCards[0]?.reason ?? ''),
    cards: groupCards,
  }));
}

function inclusionMeta(card: OptimizeCard): string {
  const parts: string[] = [];
  if (card.roleLabel) parts.push(card.roleLabel);
  if (card.inclusion != null) parts.push(`In ${Math.round(card.inclusion)}% of decks`);
  else parts.push('Suggestion');
  return parts.join(' · ');
}

function GroupCheckbox({
  state,
  label,
  onToggle,
  disabled,
}: {
  state: TriState;
  label: string;
  onToggle: () => void;
  disabled?: boolean;
}) {
  const checked = state === true;
  const ariaLabel = state === true ? `Deselect all in ${label}` : `Select all in ${label}`;
  return (
    <input
      type="checkbox"
      className="optimize-checkbox"
      checked={checked}
      ref={(el) => {
        if (el) el.indeterminate = state === 'mixed';
      }}
      onChange={onToggle}
      disabled={disabled}
      aria-label={ariaLabel}
      title={ariaLabel}
    />
  );
}

function OptimizeTile({
  card,
  side,
  checked,
  owned,
  onToggle,
  onPreview,
  disabled,
}: {
  card: OptimizeCard;
  side: OptimizeSide;
  checked: boolean;
  owned: boolean;
  onToggle: () => void;
  onPreview: () => void;
  disabled?: boolean;
}) {
  const inclusion = card.inclusion ?? 0;
  // Consensus bar: width = inclusion %, hue red→amber→emerald.
  const hue = Math.min(120, Math.max(0, inclusion * 1.2));
  const width = Math.min(100, Math.max(4, inclusion));
  const checkLabel = checked
    ? side === 'remove'
      ? `Keep ${card.name} (cancel removal)`
      : `Skip ${card.name} (cancel addition)`
    : side === 'remove'
      ? `Remove ${card.name}`
      : `Add ${card.name}`;

  return (
    <li className={`optimize-tile${checked ? '' : ' is-unchecked'}`}>
      <label className="optimize-tile-label">
        <input
          type="checkbox"
          className="optimize-checkbox optimize-tile-check"
          checked={checked}
          onChange={onToggle}
          disabled={disabled}
          aria-label={checkLabel}
        />
        <button
          type="button"
          className="optimize-tile-art"
          // Tap the art to preview the card without toggling the checkbox.
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onPreview();
          }}
          aria-label={`Preview ${card.name}`}
        >
          <img
            src={resolveThumb(card)}
            alt=""
            loading="lazy"
            decoding="async"
            onError={(e) => {
              const img = e.currentTarget;
              const fallback = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(
                card.name
              )}&format=image&version=normal`;
              if (img.src !== fallback) img.src = fallback;
            }}
          />
          {card.isGameChanger && (
            <span className="optimize-tile-gc" title="Game Changer (EDHREC)">
              GC
            </span>
          )}
        </button>
        <span className="optimize-tile-body">
          <span className="optimize-tile-name" title={card.name}>
            {card.name}
          </span>
          <span className="optimize-tile-meta">
            {inclusionMeta(card)}
            {card.isThemeSynergy && (
              <span className="optimize-tile-theme" title="High synergy with commander themes">
                Synergy
              </span>
            )}
            <OwnershipBadge owned={owned} />
          </span>
          {card.inclusion != null && (
            <span className="optimize-tile-bar" aria-hidden>
              <span
                className="optimize-tile-bar-fill"
                style={{
                  width: `${width}%`,
                  backgroundColor: `hsl(${hue}, 70%, 45%)`,
                }}
              />
            </span>
          )}
        </span>
      </label>
    </li>
  );
}

function OptimizeColumn({
  side,
  groups,
  totalCount,
  plan,
  ownedNames,
  applying,
  onPreview,
  emptyHint,
}: {
  side: OptimizeSide;
  groups: CardGroup[];
  totalCount: number;
  plan: ReturnType<typeof useOptimizePlan>;
  ownedNames: Set<string>;
  applying: boolean;
  /** Open the card-detail carousel over this column's cards, at `name`. */
  onPreview: (cards: OptimizeCard[], name: string) => void;
  /** Shown in place of the tiles when this column has no groups. */
  emptyHint?: string;
}) {
  const allNames = useMemo(() => groups.flatMap((g) => g.cards.map((c) => c.name)), [groups]);
  const allCards = useMemo(() => groups.flatMap((g) => g.cards), [groups]);
  const groupState = side === 'remove' ? plan.removalGroupState : plan.additionGroupState;
  const isChecked = side === 'remove' ? plan.isRemovalChecked : plan.isAdditionChecked;
  const columnState = groupState(allNames);
  const heading = side === 'remove' ? 'Remove' : 'Add';

  return (
    <section className={`optimize-column is-${side}`} aria-label={`${heading} suggestions`}>
      <header className="optimize-column-head">
        <h3 className="optimize-column-title">
          {heading} <span className="optimize-column-count">({totalCount})</span>
        </h3>
        <GroupCheckbox
          state={columnState}
          label={`${heading} suggestions`}
          onToggle={() => plan.setAll(side, columnState !== true)}
          disabled={applying || totalCount === 0}
        />
      </header>

      {groups.length === 0 && emptyHint && <p className="optimize-column-empty">{emptyHint}</p>}

      {groups.map((group) => {
        const groupNames = group.cards.map((c) => c.name);
        const state = groupState(groupNames);
        return (
          <div key={group.category} className="optimize-group">
            <div className="optimize-group-head">
              <span className="optimize-group-label">{group.label}</span>
              <span className="optimize-group-count">{group.cards.length}</span>
              <GroupCheckbox
                state={state}
                label={group.label}
                onToggle={() => plan.toggleGroup(side, groupNames)}
                disabled={applying}
              />
            </div>
            <ul className="optimize-tiles">
              {group.cards.map((card) => (
                <OptimizeTile
                  key={card.name}
                  card={card}
                  side={side}
                  checked={isChecked(card.name)}
                  owned={side === 'add' && ownedNames.has(card.name)}
                  onToggle={() => plan.toggle(side, card.name)}
                  onPreview={() => onPreview(allCards, card.name)}
                  disabled={applying}
                />
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

export function OptimizePanel({
  swaps,
  currentSize,
  ownedNames,
  onApply,
  applying = false,
}: OptimizePanelProps): JSX.Element {
  const owned = useMemo(() => ownedNames ?? new Set<string>(), [ownedNames]);

  const carousel = useCardCarousel('Optimize suggestions');
  // Open the carousel over a column's cards, labelled with each card's role +
  // inclusion, starting at the tapped one.
  const openPreview = (cards: OptimizeCard[], tappedName: string) =>
    void carousel.open(
      cards.map((c) => ({ name: c.name, label: inclusionMeta(c) })),
      tappedName
    );

  // "Owned only" constrains the Add column to cards already in the collection —
  // a "free upgrades from what I have" mode. The filtered set feeds the hook so
  // totals/Apply stay honest.
  const [ownedOnly, setOwnedOnly] = useState(false);
  const ownedAdditionCount = useMemo(
    () => swaps.additions.filter((c) => owned.has(c.name)).length,
    [swaps.additions, owned]
  );
  // Balance the Remove menu to the adds on offer: show only as many cuts as are
  // needed to keep the deck legal once those adds go in, taking the best-ranked
  // cuts. `swaps.removals` arrives globally sorted worst-card-first (sortScore =
  // inclusion + curve adjust, with synergy/combo/load-bearing protection floors
  // applied upstream), so slicing the front IS "pick the best N to cut". This
  // makes a swap read as a swap (5 owned adds → the 5 best cuts) instead of
  // dumping every possible cut regardless of how many cards are going in.
  // Over-size decks get extra cuts (trim the excess down to legal); under-size
  // decks get none (fill empty slots first, don't force swaps).
  const effectiveSwaps = useMemo(() => {
    const additions = ownedOnly
      ? swaps.additions.filter((c) => owned.has(c.name))
      : swaps.additions;
    const cutsNeeded = Math.max(0, currentSize + additions.length - MAX_DECK_SIZE);
    const removals = swaps.removals.slice(0, Math.min(swaps.removals.length, cutsNeeded));
    return { removals, additions };
  }, [swaps, ownedOnly, owned, currentSize]);

  const plan = useOptimizePlan(effectiveSwaps, currentSize);
  const removalGroups = useMemo(
    () => groupByCategory(effectiveSwaps.removals),
    [effectiveSwaps.removals]
  );
  const additionGroups = useMemo(
    () => groupByCategory(effectiveSwaps.additions),
    [effectiveSwaps.additions]
  );

  const isEmpty = swaps.removals.length === 0 && swaps.additions.length === 0;
  if (isEmpty) {
    return (
      <section className="optimize-panel" aria-label="Optimize deck">
        <p className="optimize-empty">Looks optimized — no high-confidence swaps right now.</p>
      </section>
    );
  }

  const { cutCount, addCount, projectedSize, scoreDelta, priceDelta } = plan.totals;
  const nothingSelected = cutCount === 0 && addCount === 0;
  const overSize = projectedSize > MAX_DECK_SIZE;
  const underSize = projectedSize < MAX_DECK_SIZE;
  const scoreSign = scoreDelta > 0 ? '+' : '';
  const priceSign =
    priceDelta != null && priceDelta > 0 ? '+' : priceDelta != null && priceDelta < 0 ? '−' : '';

  const applyAria = `Apply ${cutCount} cut${cutCount === 1 ? '' : 's'} and ${addCount} addition${
    addCount === 1 ? '' : 's'
  }, projected deck size ${projectedSize}`;

  return (
    <section className="optimize-panel" aria-label="Optimize deck">
      {swaps.additions.length > 0 && (
        <div className="optimize-toolbar">
          <label className="optimize-owned-toggle">
            <input
              type="checkbox"
              className="optimize-checkbox"
              checked={ownedOnly}
              onChange={() => setOwnedOnly((v) => !v)}
              disabled={applying}
              aria-label="Owned upgrades only"
            />
            <span>Owned upgrades only</span>
            <span className="optimize-owned-count">{ownedAdditionCount} owned</span>
          </label>
        </div>
      )}

      <div className="optimize-columns">
        <OptimizeColumn
          side="remove"
          groups={removalGroups}
          totalCount={effectiveSwaps.removals.length}
          plan={plan}
          ownedNames={owned}
          applying={applying}
          onPreview={openPreview}
        />
        <OptimizeColumn
          side="add"
          groups={additionGroups}
          totalCount={effectiveSwaps.additions.length}
          plan={plan}
          ownedNames={owned}
          applying={applying}
          onPreview={openPreview}
          emptyHint={
            ownedOnly
              ? 'No upgrades in your collection right now — turn off “Owned upgrades only” to see all suggestions.'
              : undefined
          }
        />
      </div>

      <div className="optimize-applybar" role="region" aria-label="Plan summary">
        <dl className="optimize-totals">
          <div className="optimize-total">
            <dt>Cut</dt>
            <dd className="is-remove">{cutCount}</dd>
          </div>
          <div className="optimize-total">
            <dt>Add</dt>
            <dd className="is-add">{addCount}</dd>
          </div>
          <div className="optimize-total">
            <dt>Size</dt>
            <dd className={overSize ? 'is-warn' : underSize ? 'is-under' : ''}>{projectedSize}</dd>
          </div>
          <div className="optimize-total">
            <dt>Score</dt>
            <dd className={scoreDelta > 0 ? 'is-add' : scoreDelta < 0 ? 'is-remove' : ''}>
              {scoreSign}
              {scoreDelta}
            </dd>
          </div>
          {priceDelta != null && (
            <div className="optimize-total">
              <dt>Price</dt>
              <dd>
                {priceSign}${Math.abs(priceDelta).toFixed(2)}
              </dd>
            </div>
          )}
        </dl>
        <button
          type="button"
          className="optimize-apply"
          disabled={nothingSelected || applying}
          aria-label={applyAria}
          onClick={() => onApply(plan.checkedRemovalNames, plan.checkedAdditionNames)}
        >
          {applying ? 'Applying…' : 'Apply changes'}
        </button>
      </div>

      {carousel.preview}
    </section>
  );
}
