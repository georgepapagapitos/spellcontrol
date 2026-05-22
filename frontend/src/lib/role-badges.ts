// Single source of truth for the 2-letter deck-role badges (RA / MP / DR
// / …). Lives in lib/ — not DeckDisplay — so the deck list, the grid
// tiles, the toolbar legend, the tap-to-reveal popover, and the card
// preview panel all decode roles the same way and can't drift apart.
import {
  cardMatchesRole,
  getCardRole,
  getRampSubtype,
  getRemovalSubtype,
  getBoardwipeSubtype,
  getCardDrawSubtype,
  hasMultipleRoles,
  type RoleKey,
} from '@/deck-builder/services/tagger/client';
import type { ScryfallCard } from '@/deck-builder/types';

export type { RoleKey };

// Top-level role → human label (used by multiRoleTitle).
export const ROLE_TITLES: Record<RoleKey, string> = {
  ramp: 'Ramp',
  removal: 'Removal',
  boardwipe: 'Board Wipe',
  cardDraw: 'Card Advantage',
};

export type RoleBadge = { label: string; title: string; tone: string };

// The card fields role classification actually reads. Accepting this
// structural type (rather than the full ScryfallCard) lets the card
// preview panel decode a role from just a card name — ScryfallCard
// still satisfies it, so existing deck-list callers are unaffected.
export type RoleCardInput = Pick<ScryfallCard, 'name'> &
  Partial<
    Pick<
      ScryfallCard,
      | 'deckRole'
      | 'rampSubtype'
      | 'removalSubtype'
      | 'boardwipeSubtype'
      | 'cardDrawSubtype'
      | 'multiRole'
    >
  >;

// 2-letter badge text + full name, keyed by functional-subtype tone.
export const ROLE_BADGE_BY_TONE: Record<string, { label: string; title: string }> = {
  'mana-producer': { label: 'MP', title: 'Mana Producer' },
  'mana-rock': { label: 'MR', title: 'Mana Rock' },
  'cost-reducer': { label: 'CR', title: 'Cost Reducer' },
  ramp: { label: 'RA', title: 'Ramp' },
  counterspell: { label: 'CT', title: 'Counterspell' },
  bounce: { label: 'BN', title: 'Bounce' },
  'spot-removal': { label: 'SR', title: 'Spot Removal' },
  removal: { label: 'RE', title: 'Removal' },
  'bounce-wipe': { label: 'BW', title: 'Bounce Wipe' },
  boardwipe: { label: 'WI', title: 'Board Wipe' },
  tutor: { label: 'TU', title: 'Tutor' },
  wheel: { label: 'WH', title: 'Wheel' },
  cantrip: { label: 'CN', title: 'Cantrip' },
  'card-draw': { label: 'DR', title: 'Card Draw' },
  'card-advantage': { label: 'CA', title: 'Card Advantage' },
};

// Grouped ordering for the legend / popover (by top-level role, matching
// the Stats panel's Ramp / Removal / Board wipe / Card draw sections).
export const ROLE_BADGE_GROUPS: { group: string; tones: string[] }[] = [
  { group: 'Ramp', tones: ['mana-producer', 'mana-rock', 'cost-reducer', 'ramp'] },
  { group: 'Removal', tones: ['counterspell', 'bounce', 'spot-removal', 'removal'] },
  { group: 'Board wipe', tones: ['bounce-wipe', 'boardwipe'] },
  { group: 'Card draw', tones: ['tutor', 'wheel', 'cantrip', 'card-draw', 'card-advantage'] },
];

// tone → its top-level group label, derived from ROLE_BADGE_GROUPS so the
// popover can show e.g. "Mana Producer · Ramp" without a second table.
export const ROLE_GROUP_BY_TONE: Record<string, string> = Object.fromEntries(
  ROLE_BADGE_GROUPS.flatMap((g) => g.tones.map((tone) => [tone, g.group]))
);

function badge(tone: string): RoleBadge {
  return { ...ROLE_BADGE_BY_TONE[tone], tone };
}

// Manually-built decks don't go through the generator/enricher, so the
// deckRole/*Subtype fields on the card are typically empty. Fall back to
// the bundled tagger (by card name) so badges show up the same way for
// both flows — and so callers that only have a name-bearing card work.
export function getRoleBadge(card: RoleCardInput): RoleBadge | null {
  const role = card.deckRole ?? getCardRole(card.name);
  if (!role) return null;
  switch (role) {
    case 'ramp': {
      const sub = card.rampSubtype ?? getRampSubtype(card.name);
      switch (sub) {
        case 'mana-producer':
          return badge('mana-producer');
        case 'mana-rock':
          return badge('mana-rock');
        case 'cost-reducer':
          return badge('cost-reducer');
        default:
          return badge('ramp');
      }
    }
    case 'removal': {
      const sub = card.removalSubtype ?? getRemovalSubtype(card.name);
      switch (sub) {
        case 'counterspell':
          return badge('counterspell');
        case 'bounce':
          return badge('bounce');
        case 'spot-removal':
          return badge('spot-removal');
        default:
          return badge('removal');
      }
    }
    case 'boardwipe': {
      const sub = card.boardwipeSubtype ?? getBoardwipeSubtype(card.name);
      switch (sub) {
        case 'bounce-wipe':
          return badge('bounce-wipe');
        default:
          return badge('boardwipe');
      }
    }
    case 'cardDraw': {
      const sub = card.cardDrawSubtype ?? getCardDrawSubtype(card.name);
      switch (sub) {
        case 'tutor':
          return badge('tutor');
        case 'wheel':
          return badge('wheel');
        case 'cantrip':
          return badge('cantrip');
        case 'card-draw':
          return badge('card-draw');
        default:
          return badge('card-advantage');
      }
    }
    default:
      return null;
  }
}

// Every top-level role a card fills, in canonical order. Used by the card
// preview panel and the multi-role popover to spell roles out in full.
export function rolesForCard(card: RoleCardInput): RoleKey[] {
  const roles: RoleKey[] = ['ramp', 'removal', 'boardwipe', 'cardDraw'];
  return roles.filter((r) => cardMatchesRole(card.name, r));
}

export function multiRoleTitle(card: RoleCardInput): string {
  return (
    rolesForCard(card)
      .map((r) => ROLE_TITLES[r])
      .join(' + ') || 'Multi-role'
  );
}

// A card counts as multi-role if the generator flagged it, or — for
// hand-built decks — the tagger sees it filling more than one role.
export function isMultiRole(card: RoleCardInput): boolean {
  return card.multiRole ?? hasMultipleRoles(card.name);
}
