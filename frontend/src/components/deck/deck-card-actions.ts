// What a card's menu can do, as data rather than JSX. One definition feeds
// BOTH the list row's kebab and the pointer-anchored menu the grid, stacks
// and right-click open, so the two cannot drift, which is the risk the
// STYLE_GUIDE's "editing is centralized" ruling was guarding against when it
// said not to add a second surface.
//
// Pure and DOM-free on purpose: the gating here (what is disabled, what is
// absent, which label a multi-copy row gets) is the part worth testing.
import { coverHasArt } from '@spellcontrol/deck-metrics';
import type { ScryfallCard } from '@/deck-builder/types';
import { getMaxCopies } from '@/lib/deck/deck-validation';
import { withTagAdded, withTagRemoved } from '@/lib/deck/deck-tags';
import type { Row } from './deck-display-rows';

/** Clusters, in render order. The menu runs past a dozen rows, and the style
 *  guide asks for labelled sections rather than one flat list once it does. */
export type DeckCardActionSection =
  'copies' | 'move' | 'collection' | 'commander' | 'tag' | 'cover';

export const SECTION_TITLES: Record<DeckCardActionSection, string> = {
  copies: 'Copies',
  move: 'Move',
  collection: 'Collection',
  commander: 'Command zone',
  tag: 'Tags',
  cover: 'Cover',
};

export const SECTION_ORDER: DeckCardActionSection[] = [
  'copies',
  'move',
  'tag',
  'collection',
  'commander',
  'cover',
];

export interface DeckCardAction {
  key: string;
  label: string;
  section: DeckCardActionSection;
  disabled?: boolean;
  /** Drills into a submenu page instead of acting. 'move' re-files the card
   *  (hoists a tag to primary); 'add' toggles membership without moving it. */
  submenu?: 'move' | 'add';
  run?: () => void;
}

export interface DeckCardActionCtx {
  row: Row;
  /** Format singleton-ness, for the same copy ceiling the stepper uses. */
  isSingleton?: boolean;
  /** Label of the zone this row can move to ("sideboard" / "mainboard"). */
  moveZone?: string;
  onEditCard?: (slotId: string, card: ScryfallCard) => void;
  onSetQty?: (card: ScryfallCard, qty: number, opts?: { relative?: boolean }) => void;
  onRemoveCard?: (slotId: string) => void;
  onMoveToZone?: (slotIds: string[]) => void;
  onMoveToConsidering?: (slotIds: string[]) => void;
  onUseOwnCopy?: (card: ScryfallCard) => void;
  onMoveToAnotherDeck?: (card: ScryfallCard) => void;
  onReleaseCopy?: (card: ScryfallCard) => void;
  onMakeCommander?: (slotId: string, card: ScryfallCard) => void;
  canMakeCommander?: (card: ScryfallCard) => boolean;
  onMakePartner?: (slotId: string, card: ScryfallCard) => void;
  canMakePartner?: (card: ScryfallCard) => boolean;
  /** Opens the commander picker to replace the seated commander (E465).
   *  Offered on the commander row only. */
  onChangeCommander?: () => void;
  /** Already bound to this row's zone by the caller, so the action list never
   *  needs to know which zone it is in. Absent means no tag actions. */
  onSetRowTags?: (slotIds: string[], tags: string[]) => void;
  /** The deck's cover art (lib/deck/deck-cover): the owner's pick by name, the
   *  card the deck wears right now, and the setter (null = automatic again).
   *  Absent means no cover action: a read-only deck, or an out-zone row. */
  cover?: {
    chosen: string | null;
    current: string | null;
    set: (cardName: string | null) => void;
  };
}

export function deckCardActions(ctx: DeckCardActionCtx): DeckCardAction[] {
  const {
    row,
    isSingleton,
    moveZone,
    onEditCard,
    onSetQty,
    onRemoveCard,
    onMoveToZone,
    onMoveToConsidering,
    onUseOwnCopy,
    onMoveToAnotherDeck,
    onReleaseCopy,
    onMakeCommander,
    canMakeCommander,
    onMakePartner,
    canMakePartner,
    onChangeCommander,
    onSetRowTags,
    cover,
  } = ctx;

  // A commander row carries no deck slot, so every slot-bound action is
  // absent for it rather than present and broken.
  const hasSlots = row.slotIds.length > 0;
  const canRemove = !!onRemoveCard && hasSlots;
  const canEditQty = !!onSetQty && hasSlots;
  const atCap = row.qty >= getMaxCopies(row.card, isSingleton ?? true);

  const out: DeckCardAction[] = [];

  if (onEditCard && hasSlots) {
    out.push({
      key: 'edit-printing',
      label: 'Edit printing',
      section: 'copies',
      run: () => onEditCard(row.slotIds[0], row.card),
    });
  }
  if (canEditQty) {
    out.push({
      key: 'add-copy',
      label: 'Add another copy',
      section: 'copies',
      // Same ceiling as the stepper, so the two add affordances agree by
      // construction rather than by convention.
      disabled: atCap,
      run: () => onSetQty!(row.card, row.qty + 1),
    });
  }
  out.push({
    key: 'remove-one',
    label: row.qty > 1 ? 'Remove one copy' : 'Remove from deck',
    section: 'copies',
    disabled: !canRemove,
    run: () => onRemoveCard!(row.slotIds[row.slotIds.length - 1]),
  });
  if (row.qty > 1) {
    out.push({
      key: 'remove-all',
      label: `Remove all ${row.qty} copies`,
      section: 'copies',
      disabled: !canRemove && !canEditQty,
      run: () => {
        // Prefer the bulk path so the host shows one undo toast for the batch.
        if (canEditQty) onSetQty!(row.card, 0);
        else if (canRemove) for (const id of [...row.slotIds].reverse()) onRemoveCard!(id);
      },
    });
  }

  if (onMoveToZone && moveZone && hasSlots) {
    out.push({
      key: 'move-zone-one',
      label: row.qty > 1 ? `Move one copy to ${moveZone}` : `Move to ${moveZone}`,
      section: 'move',
      run: () => onMoveToZone([row.slotIds[0]]),
    });
    if (row.qty > 1) {
      out.push({
        key: 'move-zone-all',
        label: `Move all ${row.qty} copies to ${moveZone}`,
        section: 'move',
        run: () => onMoveToZone(row.slotIds),
      });
    }
  }
  if (onMoveToConsidering && hasSlots) {
    out.push({
      key: 'move-considering-one',
      label: row.qty > 1 ? 'Move one copy to considering' : 'Move to considering',
      section: 'move',
      run: () => onMoveToConsidering([row.slotIds[0]]),
    });
    if (row.qty > 1) {
      out.push({
        key: 'move-considering-all',
        label: `Move all ${row.qty} copies to considering`,
        section: 'move',
        run: () => onMoveToConsidering(row.slotIds),
      });
    }
  }

  if (onSetRowTags && hasSlots) {
    // Two intents, deliberately separate. "Move" answers "which section does
    // this card belong in", which is the partition the Tags lens renders.
    // "Add" answers "what else is this card", which only the card-preview
    // panel could do before — so the fast path could not express something
    // the slow path could.
    out.push({ key: 'tag-pick', label: 'Move to tag', section: 'tag', submenu: 'move' });
    out.push({ key: 'tag-add', label: 'Add tag', section: 'tag', submenu: 'add' });
    if (row.tags.length > 0) {
      out.push({
        key: 'tag-clear',
        label: `Take out of ${row.tags[0]}`,
        section: 'tag',
        // Drops only the primary, which is the tag deciding this card's
        // section. Its other tags are its own taxonomy and the deck search
        // still finds it by them.
        run: () => onSetRowTags(row.slotIds, row.tags.slice(1)),
      });
    }
  }

  if (onUseOwnCopy && row.claimedElsewhereQty > 0 && hasSlots) {
    out.push({
      key: 'use-own-copy',
      label: 'Use my copy',
      section: 'collection',
      run: () => onUseOwnCopy(row.card),
    });
  }
  if (onMoveToAnotherDeck && !row.isPartner && hasSlots) {
    out.push({
      key: 'move-deck',
      label: 'Move to another deck…',
      section: 'collection',
      run: () => onMoveToAnotherDeck(row.card),
    });
  }
  if (onReleaseCopy && row.allocatedQty > 0) {
    out.push({
      key: 'release-copy',
      label: 'Release copy',
      section: 'collection',
      run: () => onReleaseCopy(row.card),
    });
  }

  if (onMakeCommander && canMakeCommander?.(row.card) && hasSlots) {
    out.push({
      key: 'make-commander',
      label: 'Make commander',
      section: 'commander',
      run: () => onMakeCommander(row.slotIds[0], row.card),
    });
  }
  if (onMakePartner && canMakePartner?.(row.card) && hasSlots) {
    out.push({
      key: 'make-partner',
      label: 'Make partner',
      section: 'commander',
      run: () => onMakePartner(row.slotIds[0], row.card),
    });
  }
  // The commander row is the one row with no slot that isn't the partner.
  if (onChangeCommander && !hasSlots && !row.isPartner) {
    out.push({
      key: 'change-commander',
      label: 'Change commander',
      section: 'commander',
      run: onChangeCommander,
    });
  }

  if (cover && coverHasArt(row.card)) {
    const name = row.card.name;
    if (cover.chosen === name) {
      out.push({
        key: 'cover-clear',
        label: 'Stop using as cover',
        section: 'cover',
        run: () => cover.set(null),
      });
    } else if (cover.current !== name) {
      // Absent on the card already wearing it: pinning the automatic pick
      // would change nothing the user can see.
      out.push({
        key: 'cover-set',
        label: 'Use as deck cover',
        section: 'cover',
        run: () => cover.set(name),
      });
    }
  }

  return out;
}

/**
 * Whether a card has a menu at all: at least one action the user can take.
 * A read-only deck (a shared link, a public profile) passes no handlers, and
 * its menu used to open on a lone disabled "Remove from deck". A menu with
 * nothing to do is a dead end, so it doesn't render: no ⋮, and a right-click
 * gets the browser's own menu (STYLE_GUIDE § Verbs — Menus).
 */
export function hasCardActions(ctx: DeckCardActionCtx): boolean {
  return deckCardActions(ctx).some((action) => !action.disabled);
}

/**
 * The tag picker's rows. A card's section is its FIRST tag (see groupByTag),
 * so picking one HOISTS it to index 0 rather than appending: appending would
 * leave the card sitting in whatever group it was already in, and the menu
 * would have lied. Every other tag the card carries is preserved, so the
 * row's chips and the deck search are untouched.
 */
export function tagPickActions(
  row: Row,
  deckTags: string[],
  onSetRowTags: (slotIds: string[], tags: string[]) => void
): Array<DeckCardAction & { checked: boolean }> {
  return deckTags.map((tag) => ({
    key: `tag-${tag}`,
    label: tag,
    section: 'tag' as const,
    checked: row.tags[0]?.toLowerCase() === tag.toLowerCase(),
    run: () => onSetRowTags(row.slotIds, [tag, ...withTagRemoved(row.tags, tag)]),
  }));
}

/**
 * The "add tag" rows: membership, not filing. Toggling APPENDS or removes and
 * never reorders, so a card keeps the section it is already in — unlike
 * tagPickActions, which hoists on purpose.
 *
 * The one case where adding does move a card is an untagged one: its new tag
 * is necessarily `tags[0]`, so it leaves the type fallback. That is the right
 * outcome and needs no special handling.
 */
export function tagToggleActions(
  row: Row,
  deckTags: string[],
  onSetRowTags: (slotIds: string[], tags: string[]) => void
): Array<DeckCardAction & { checked: boolean }> {
  return deckTags.map((tag) => {
    const checked = row.tags.some((t) => t.toLowerCase() === tag.toLowerCase());
    return {
      key: `tag-toggle-${tag}`,
      label: tag,
      section: 'tag' as const,
      checked,
      run: () =>
        onSetRowTags(
          row.slotIds,
          checked ? withTagRemoved(row.tags, tag) : withTagAdded(row.tags, tag)
        ),
    };
  });
}
