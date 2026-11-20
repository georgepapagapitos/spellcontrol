import type { Customization } from '@/deck-builder/types';
import { isBasicLandName } from '@/lib/collection/allocations';

/**
 * Whether the collection can supply the deck the settings ask for, checked
 * before the build so the player can change the settings first (E1119).
 *
 * The count is an upper bound: every owned name in the commander's colors that
 * isn't a land counts, whatever its legality, price or rarity. So a shortfall
 * here is certain, and a build that passes can still come up short once the
 * other settings apply; the build report says so afterward.
 */
export interface OwnedCardLike {
  name: string;
  colorIdentity?: string[];
  typeLine?: string;
}

export interface BuildShortfall {
  /** 'collection': an owned-only build. 'share': an owned share it can't reach. */
  kind: 'collection' | 'share';
  /** Owned cards that fit the commander, lands aside. */
  have: number;
  /** Owned cards the settings ask for, lands aside. */
  need: number;
  /** The share asked for (kind 'share'). */
  percent?: number;
  /** Only copies no other deck holds were counted ("Only mine"). */
  freeOnly?: boolean;
}

const frontType = (typeLine: string | undefined) => (typeLine ?? '').split('//')[0];

/** Cards the deck holds besides its commander(s) and lands. */
export function nonlandSlots(
  cz: Pick<Customization, 'deckFormat' | 'landCount'>,
  hasPartner: boolean
): number {
  const size = (cz.deckFormat === 99 ? 100 : cz.deckFormat) - (hasPartner ? 2 : 1);
  return Math.max(0, size - cz.landCount);
}

/**
 * Owned names the build may use that fit the commander: in `scope` (the names
 * the chosen strategy reads), inside the color identity, not a land and not a
 * commander.
 *
 * ponytail: one slot per name. A deck of thirty Relentless Rats reads as one
 * card here and warns when it needn't; count copies for any-number cards when
 * the collection row carries oracle text.
 */
export function usableOwnedCount(
  collection: readonly OwnedCardLike[],
  scope: ReadonlySet<string>,
  colorIdentity: readonly string[],
  commanderNames: readonly string[]
): number {
  const identity = new Set(colorIdentity);
  const skip = new Set(commanderNames);
  const counted = new Set<string>();
  for (const card of collection) {
    if (counted.has(card.name) || skip.has(card.name) || !scope.has(card.name)) continue;
    if (isBasicLandName(card.name) || /\bLand\b/.test(frontType(card.typeLine))) continue;
    if (!(card.colorIdentity ?? []).every((c) => identity.has(c))) continue;
    counted.add(card.name);
  }
  return counted.size;
}

export function checkBuildFeasibility(input: {
  customization: Pick<
    Customization,
    'deckFormat' | 'landCount' | 'collectionMode' | 'collectionStrategy' | 'collectionOwnedPercent'
  >;
  hasPartner: boolean;
  colorIdentity: readonly string[];
  commanderNames: readonly string[];
  collection: readonly OwnedCardLike[];
  /** The owned names the build reads, or undefined when it reads no collection. */
  scope: ReadonlySet<string> | undefined;
}): BuildShortfall | null {
  const { customization: cz, scope } = input;
  if (!cz.collectionMode || !scope) return null;
  const strategy = cz.collectionStrategy;
  if (strategy !== 'full' && strategy !== 'available' && strategy !== 'partial') return null;

  const slots = nonlandSlots(cz, input.hasPartner);
  const have = usableOwnedCount(input.collection, scope, input.colorIdentity, input.commanderNames);
  if (strategy === 'partial') {
    const percent = cz.collectionOwnedPercent;
    // Rounded as the generator rounds its own owned target (deckGenerator's share repair).
    const need = Math.round((slots * percent) / 100);
    return have < need ? { kind: 'share', have, need, percent } : null;
  }
  if (have >= slots) return null;
  return { kind: 'collection', have, need: slots, freeOnly: strategy === 'available' };
}

const cards = (n: number) => `${n} ${n === 1 ? 'card' : 'cards'}`;

/** The dialog's words. Title asks; the body states what a build would do. */
export function describeBuildShortfall(s: BuildShortfall): { title: string; body: string } {
  const short = s.need - s.have;
  if (s.kind === 'share') {
    return {
      title: `Build below a ${s.percent}% owned share?`,
      body:
        `You own ${cards(s.have)} in this commander’s colors, and a ${s.percent}% share needs ${s.need}. ` +
        `The deck would come out ${cards(short)} under the share you set.`,
    };
  }
  return {
    title: 'Build without enough owned cards?',
    body:
      (s.freeOnly
        ? `You have ${cards(s.have)} in this commander’s colors outside your other decks`
        : `You own ${cards(s.have)} in this commander’s colors`) +
      `, and the deck needs ${s.need} besides lands. ` +
      `Extra lands or cards you don’t own would fill the other ${short}.`,
  };
}
