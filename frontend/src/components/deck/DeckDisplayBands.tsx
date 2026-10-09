// The Deck view's bands above the card list: the at-a-glance stat strip, the
// bulk-action bar, the role-filter bar and the empty-deck state. Presentational
// only; DeckDisplay owns every piece of state and passes it in. Moved out
// verbatim (T176, W5), DOM unchanged.
import { Search, Tag as TagIcon, Trash2, X } from 'lucide-react';
import { useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { formatMoney } from '@/lib/collection/format-money';
import { summarizeValidation } from '@/deck-builder/services/deckBuilder/validationChecklist';
import { ROLE_TITLES, type RoleKey } from '@/lib/deck-analysis/role-badges';
import { InfoTip } from '@/components/overlays/InfoTip';
import { Button, IconButton } from '@/components/shared/Button';
import { Chip } from '@/components/shared/Chip';
import { ToolbarPopover } from '../shared/ToolbarPopover';
import type { DeckBulkAction } from './DeckSelectionMenu';
import type { CurrencyCode } from './deck-display-rows';
import type { DeckSelection } from './deck-display-actions';
import type { DeckDisplayProps } from './deck-display-types';
import '@/styles/deck-builder-deck-extras.css';

// Deck-tab metrics, glanceable while editing the list. Each reads
// as a metric: a bold value over a small muted label. Only what the
// page hero does NOT already say — card count, value and bracket
// ride the hero on every tab and every width, so repeating them
// here was the same number twice on one screen.
export function DeckStatStrip({
  stripRef,
  health,
  onHealthClick,
  averageCmc,
  identity,
  missing,
  hasMissingCards,
  currency,
  onOpenBuyList,
  openSlots,
  onFill,
  arrivalCount,
  onOpenArrivals,
}: {
  stripRef: RefObject<HTMLDivElement | null>;
  health: ReturnType<typeof summarizeValidation>;
  onHealthClick: () => void;
  averageCmc: number;
  identity: { archetypeLabel: string } | null;
  /** `price` is null while a viewer's lens prices are still loading. */
  missing: { count: number; price: number | null };
  /** The missing tally has entries, so the stat opens the buy list. */
  hasMissingCards: boolean;
  currency: CurrencyCode;
  onOpenBuyList: () => void;
  openSlots: number | undefined;
  onFill: (() => void) | undefined;
  arrivalCount: number;
  onOpenArrivals: () => void;
}) {
  return (
    <div ref={stripRef} className="deck-stat-strip" aria-label="Deck at a glance" role="group">
      {/* The checks verdict leads, the way a deck site's header says
                  "Legal" first. It is also the phone's way down to the stats
                  under a long one-column list. */}
      <button
        type="button"
        className={`deck-stat deck-stat-btn deck-stat-health deck-stat-health--${health.tone}`}
        onClick={onHealthClick}
        aria-label={`Deck checks: ${health.label}. ${health.reason} Show deck stats.`}
      >
        <span className="deck-stat-value">{health.label}</span>
        <span className="deck-stat-label">deck checks</span>
      </button>
      <span className="deck-stat">
        <span className="deck-stat-value">{averageCmc.toFixed(2)}</span>
        {/* A phone fits the strip on one line with the short label. */}
        <span className="deck-stat-label">
          <span className="deck-stat-label-long">avg mana value</span>
          <span className="deck-stat-label-short" aria-hidden>
            avg MV
          </span>
        </span>
      </span>
      {identity && (
        <span className="deck-stat">
          <span className="deck-stat-value">{identity.archetypeLabel}</span>
          <span className="deck-stat-label">plays as</span>
        </span>
      )}
      {missing.count > 0 &&
        (hasMissingCards ? (
          <button
            type="button"
            className="deck-stat deck-stat-missing deck-stat-btn"
            onClick={onOpenBuyList}
            aria-label={`Show the ${missing.count} missing cards`}
          >
            <span className="deck-stat-value">{missing.count}</span>
            <span className="deck-stat-label">
              missing
              {missing.price != null && (
                <span className="deck-stat-label-long">
                  {' '}
                  ({formatMoney(missing.price, { currency })})
                </span>
              )}
            </span>
          </button>
        ) : (
          <span className="deck-stat deck-stat-missing">
            <span className="deck-stat-value">{missing.count}</span>
            <span className="deck-stat-label">
              missing
              {missing.price != null && (
                <span className="deck-stat-label-long">
                  {' '}
                  ({formatMoney(missing.price, { currency })})
                </span>
              )}
            </span>
          </span>
        ))}
      {onFill && !!openSlots && (
        <button
          type="button"
          className="deck-stat deck-stat-btn"
          onClick={onFill}
          aria-label={`Fill the ${openSlots} open ${openSlots === 1 ? 'slot' : 'slots'} around your cards`}
        >
          <span className="deck-stat-value">{openSlots}</span>
          <span className="deck-stat-label">open {openSlots === 1 ? 'slot' : 'slots'} · fill</span>
        </button>
      )}
      {arrivalCount > 0 && (
        <button
          type="button"
          className="deck-stat deck-stat-new deck-stat-btn"
          onClick={onOpenArrivals}
          aria-label={`Review ${arrivalCount} new ${arrivalCount === 1 ? 'card' : 'cards'} in your collection that fit this deck`}
        >
          <span className="deck-stat-value">{arrivalCount}</span>
          <span className="deck-stat-label">new {arrivalCount === 1 ? 'arrival' : 'arrivals'}</span>
        </button>
      )}
    </div>
  );
}

// Bulk-action bar (E172) — replaces nothing, sits directly under
// the toolbar only while selecting. Actions are zone-contextual:
// which buttons render depends on which zone the current
// selection is in (mainboard/sideboard/considering each have a
// different legal destination set).
export function DeckBulkBar({
  selection,
  selectionTitle,
  bulkActions,
  deckTagNames,
  onBulkEditTag,
  onDone,
}: {
  selection: DeckSelection | null;
  selectionTitle: string;
  bulkActions: DeckBulkAction[];
  deckTagNames: string[];
  onBulkEditTag: DeckDisplayProps['onBulkEditTag'];
  onDone: () => void;
}) {
  return (
    <div className="deck-bulk-bar" role="region" aria-label="Bulk actions">
      <span className="deck-bulk-count">{selection ? selectionTitle : 'Select cards'}</span>
      {bulkActions
        .filter((a) => !a.danger)
        .map((a) => (
          <Button key={a.key} onClick={a.run} className="deck-bulk-btn">
            {a.label}
          </Button>
        ))}
      {selection && onBulkEditTag && (
        <ToolbarPopover
          label="Tag"
          icon={<TagIcon width={14} height={14} strokeWidth={2} aria-hidden />}
        >
          {(close) => (
            <BulkTagPopoverBody
              existingTags={deckTagNames}
              onAdd={(tag) => {
                onBulkEditTag(selection.zone, [...selection.keys], tag, true);
                close();
              }}
              onRemove={(tag) => {
                onBulkEditTag(selection.zone, [...selection.keys], tag, false);
                close();
              }}
            />
          )}
        </ToolbarPopover>
      )}
      {bulkActions
        .filter((a) => a.danger)
        .map((a) => (
          <Button
            key={a.key}
            variant="danger"
            onClick={a.run}
            className="deck-bulk-btn"
            icon={<Trash2 width={14} height={14} strokeWidth={2} />}
          >
            {a.label}
          </Button>
        ))}
      <Button onClick={onDone} className="deck-bulk-done">
        Done
      </Button>
    </div>
  );
}

// Role-filter bar — how the deck's roles balance, and a one-tap
// lens: an active role keeps every row in place but dims the rest,
// so matching cards pop without the layout reshuffling.
export function DeckRoleBar({
  barRef,
  entries,
  active,
  setRoleFilter,
}: {
  barRef: RefObject<HTMLDivElement | null>;
  entries: (readonly [RoleKey, number])[];
  active: RoleKey | null;
  setRoleFilter: Dispatch<SetStateAction<RoleKey | null>>;
}) {
  return (
    <div ref={barRef} className="deck-role-bar" role="toolbar" aria-label="Role filter">
      {entries.map(([key, count]) => (
        <Chip
          key={key}
          className="filter-chip deck-role-bar-chip"
          pressed={active === key}
          onClick={() => setRoleFilter((cur) => (cur === key ? null : key))}
          trailing={<span className="deck-role-bar-count">{count}</span>}
        >
          {ROLE_TITLES[key]}
        </Chip>
      ))}
      {active && (
        <button
          type="button"
          className="deck-role-bar-clear"
          onClick={() => setRoleFilter(null)}
          aria-label={`Clear the ${ROLE_TITLES[active]} role filter`}
        >
          <X width={12} height={12} strokeWidth={2.2} aria-hidden />
          Clear
        </button>
      )}
      <InfoTip
        label="role filter"
        text={
          <p className="info-tip-lead">
            Each card counts once, under its main role. Tap a chip to spotlight those cards.
          </p>
        }
      />
    </div>
  );
}

// E182: a brand-new deck (no commander, no cards) previously
// rendered a fully interactive toolbar over a blank
// .deck-card-list — this is the manual builder's first
// impression, so it needs its own state rather than empty
// space. Reuses the insight-strip idiom (one row,
// --surface-raised) instead of a bespoke illustration.
// A commander-format deck with no commander yet (E465) is
// not blocked on one: adding comes first (it's the primary),
// and choosing the commander is the second door beside it,
// opening the same picker as the command zone's open slot.
export function DeckEmptyState({
  chooseCommander,
  onAddCards,
}: {
  chooseCommander: (() => void) | undefined;
  onAddCards: (() => void) | undefined;
}) {
  return (
    <div className="deck-empty-state">
      <span className="deck-empty-state-icon" aria-hidden>
        <Search width={18} height={18} strokeWidth={2} />
      </span>
      <div className="deck-empty-state-body">
        <p className="deck-empty-state-headline">This deck is empty.</p>
        <p className="deck-empty-state-detail">
          {chooseCommander
            ? 'Add cards, or choose a commander first.'
            : 'Open Add cards to start your list.'}
        </p>
      </div>
      <div
        className={
          chooseCommander
            ? 'deck-empty-state-actions deck-empty-state-actions--pair'
            : 'deck-empty-state-actions'
        }
      >
        <Button
          variant="primary"
          onClick={() => onAddCards?.()}
          className="deck-empty-state-action"
        >
          Add cards
        </Button>
        {chooseCommander && (
          <Button onClick={chooseCommander} className="deck-empty-state-action">
            Choose a commander
          </Button>
        )}
      </div>
    </div>
  );
}

// Bulk-tag popover body (E172) — a text input to add a new tag to the whole
// selection, plus the deck's existing tags as one-tap chips (add). There's no
// per-selected-card "which of these already has it" reconciliation here —
// bulkEditTag's add/remove is idempotent per slot either way, so offering
// every deck tag as an "add" chip is always safe, just sometimes a no-op for
// cards that already carry it.
function BulkTagPopoverBody({
  existingTags,
  onAdd,
  onRemove,
}: {
  existingTags: string[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const tag = draft.trim();
    if (tag) onAdd(tag);
    setDraft('');
  };
  return (
    <div className="deck-bulk-tag-popover">
      <div className="deck-bulk-tag-input-row">
        <input
          type="text"
          className="deck-bulk-tag-input"
          placeholder="New tag…"
          value={draft}
          maxLength={40}
          aria-label="New tag name"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
        />
        <Button variant="primary" onClick={commit} className="deck-bulk-tag-add">
          Add
        </Button>
      </div>
      {existingTags.length > 0 && (
        <ul className="deck-bulk-tag-chip-list" aria-label="Existing tags">
          {existingTags.map((tag) => (
            <li key={tag}>
              <Chip
                className="deck-bulk-tag-chip"
                onClick={() => onAdd(tag)}
                title={`Add "${tag}" to selection`}
              >
                {tag}
              </Chip>
              <IconButton
                className="deck-bulk-tag-chip-remove"
                onClick={() => onRemove(tag)}
                label={`Remove "${tag}" from selection`}
                icon={<X width={11} height={11} strokeWidth={2.4} />}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
