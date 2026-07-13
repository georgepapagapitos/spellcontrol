import type { ScryfallCard, DeckFormatConfig } from '@/deck-builder/types';
import type { DeckCard } from '@/store/decks';
import { BASIC_LAND_NAMES } from './allocations';
import { isPdhCommanderEligible } from './commanders';
import { isLand } from './hand-classify';

/** Synthetic slot ids for commander-zone issues — the commanders live outside
 *  the mainboard/sideboard slot lists, so they get stable keys of their own. */
export const COMMANDER_SLOT_ID = 'commander';
export const PARTNER_COMMANDER_SLOT_ID = 'partner-commander';
/** Synthetic slot ids for the whole-deck checks the generation gate adds
 *  (validateGeneratedDeck below) — these aren't tied to a single card. */
export const SIZE_SLOT_ID = 'size';
export const LAND_FLOOR_SLOT_ID = 'land-floor';

type LegalityIssueKind =
  | 'not-legal'
  | 'over-copy-limit'
  | 'color-identity'
  | 'over-size'
  | 'under-size'
  | 'land-floor';

export interface LegalityIssue {
  slotId: string;
  cardName: string;
  issue: LegalityIssueKind;
  detail: string;
}

export function isCardLegal(card: ScryfallCard, legalityKey: string): boolean {
  const status = card.legalities?.[legalityKey];
  return status === 'legal' || status === 'restricted';
}

export function getMaxCopies(card: ScryfallCard, isSingleton: boolean): number {
  if (BASIC_LAND_NAMES.has(card.name)) return 99;
  const text = card.oracle_text ?? '';
  if (/a deck can have any number of cards named/i.test(text)) return 99;
  const upToMatch = text.match(/a deck can have up to (\d+)/i);
  if (upToMatch) return parseInt(upToMatch[1], 10);
  return isSingleton ? 1 : 4;
}

/**
 * Returns true if the card's color identity fits inside the allowed set.
 * Allowed is the commander(s)' combined color identity. Colorless cards
 * (empty color_identity) fit any commander.
 */
export function fitsColorIdentity(card: ScryfallCard, allowed: Set<string>): boolean {
  const ci = card.color_identity ?? [];
  for (const c of ci) {
    if (!allowed.has(c)) return false;
  }
  return true;
}

/** Commander color identity from the commander(s). Empty for non-commander formats. */
export function deckColorIdentity(
  commander: ScryfallCard | null,
  partnerCommander: ScryfallCard | null
): Set<string> {
  const out = new Set<string>();
  for (const c of commander?.color_identity ?? []) out.add(c);
  for (const c of partnerCommander?.color_identity ?? []) out.add(c);
  return out;
}

/**
 * Effective color identity for any deck. For commander formats this is the
 * commanders' color identity. For non-commander formats it's the union of
 * color_identity across the mainboard and sideboard.
 */
export function effectiveDeckColors(deck: {
  commander: ScryfallCard | null;
  partnerCommander: ScryfallCard | null;
  cards: DeckCard[];
  sideboard?: DeckCard[];
}): Set<string> {
  if (deck.commander || deck.partnerCommander) {
    return deckColorIdentity(deck.commander, deck.partnerCommander);
  }
  const out = new Set<string>();
  for (const dc of deck.cards) {
    for (const c of dc.card.color_identity ?? []) out.add(c);
  }
  for (const dc of deck.sideboard ?? []) {
    for (const c of dc.card.color_identity ?? []) out.add(c);
  }
  return out;
}

/**
 * Per-color usage count across mainboard + sideboard, counting each card
 * once per color it contributes. Commander(s) excluded since they don't
 * meaningfully reflect usage frequency. Use this to order color pips by
 * how much each color shows up in the deck.
 */
export function deckColorFrequency(deck: {
  cards: DeckCard[];
  sideboard?: DeckCard[];
}): Map<string, number> {
  const counts = new Map<string, number>();
  const tally = (dc: DeckCard) => {
    for (const c of dc.card.color_identity ?? []) {
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
  };
  for (const dc of deck.cards) tally(dc);
  for (const dc of deck.sideboard ?? []) tally(dc);
  return counts;
}

/** Unique card-name count across legality issues — for summary badges. */
export function countFlaggedCards(issues: LegalityIssue[]): number {
  return new Set(issues.map((i) => i.cardName)).size;
}

/**
 * Returns a human-readable warning when the mainboard card count exceeds the
 * format's allowed size. Sideboard cards are intentionally excluded — they
 * live in a separate zone and don't count toward the main deck limit.
 * Under-count is not flagged here since partially-built decks are normal.
 */
export function validateDeckSize(mainboardCount: number, config: DeckFormatConfig): string | null {
  if (mainboardCount > config.mainboardSize) {
    const over = mainboardCount - config.mainboardSize;
    return `${over} card${over === 1 ? '' : 's'} over the ${config.label} limit (${config.mainboardSize})`;
  }
  return null;
}

export function validateDeck(
  cards: DeckCard[],
  sideboard: DeckCard[],
  config: DeckFormatConfig,
  options: {
    commander?: ScryfallCard | null;
    partnerCommander?: ScryfallCard | null;
  } = {}
): LegalityIssue[] {
  const issues: LegalityIssue[] = [];

  const allCards = [
    ...cards.map((c) => ({ ...c, zone: 'main' as const })),
    ...sideboard.map((c) => ({ ...c, zone: 'side' as const })),
  ];

  // Legality against Scryfall's per-format key.
  for (const entry of allCards) {
    if (!isCardLegal(entry.card, config.legalityKey)) {
      issues.push({
        slotId: entry.slotId,
        cardName: entry.card.name,
        issue: 'not-legal',
        detail: `Not legal in ${config.label}`,
      });
    }
  }

  // Commander-zone legality (PDH). The commander is validated with the
  // DERIVED predicate, never isCardLegal: PDH commanders are uncommons, which
  // read `not_legal` under Scryfall's paupercommander key — the oracle-level
  // "printed at common" stamp only describes the 99.
  if (config.format === 'paupercommander') {
    const commanderZone = [
      { card: options.commander, slotId: COMMANDER_SLOT_ID },
      { card: options.partnerCommander, slotId: PARTNER_COMMANDER_SLOT_ID },
    ];
    for (const { card, slotId } of commanderZone) {
      if (card && !isPdhCommanderEligible(card)) {
        issues.push({
          slotId,
          cardName: card.name,
          issue: 'not-legal',
          detail:
            'Not a legal Pauper Commander — the commander must be a creature printed at uncommon',
        });
      }
    }
  }

  // Commander color identity. Only enforced for commander-bearing formats
  // when at least one commander is set — otherwise we have no allowed set.
  if (config.hasCommander && (options.commander || options.partnerCommander)) {
    const allowed = deckColorIdentity(options.commander ?? null, options.partnerCommander ?? null);
    const allowedLabel = allowed.size === 0 ? 'colorless' : [...allowed].sort().join('/');
    for (const entry of allCards) {
      if (!fitsColorIdentity(entry.card, allowed)) {
        issues.push({
          slotId: entry.slotId,
          cardName: entry.card.name,
          issue: 'color-identity',
          detail: `Outside commander color identity (${allowedLabel})`,
        });
      }
    }
  }

  // Copy limits (counted across main + side combined).
  const nameCounts = new Map<string, { count: number; slotIds: string[] }>();
  for (const entry of allCards) {
    const name = entry.card.name;
    const existing = nameCounts.get(name);
    if (existing) {
      existing.count++;
      existing.slotIds.push(entry.slotId);
    } else {
      nameCounts.set(name, { count: 1, slotIds: [entry.slotId] });
    }
  }

  for (const [name, { count, slotIds }] of nameCounts) {
    const sampleCard = allCards.find((c) => c.card.name === name)!.card;
    const max = getMaxCopies(sampleCard, config.isSingleton);
    if (count > max) {
      for (const slotId of slotIds) {
        issues.push({
          slotId,
          cardName: name,
          issue: 'over-copy-limit',
          detail: `${count} copies (max ${max} in ${config.label})`,
        });
      }
    }
  }

  return issues;
}

/**
 * Under-size counterpart to validateDeckSize, for GENERATED decks only.
 * validateDeckSize deliberately skips under-count because a partially-built
 * MANUAL deck is normal (see its own comment) — but a freshly generated deck
 * that landed short of the format's mainboard size is a generation bug (a
 * filter starved the pool, a phase bailed early), not an in-progress state.
 * Never call this from manual-edit display; it's for validateGeneratedDeck.
 */
export function validateGeneratedDeckUnderSize(
  mainboardCount: number,
  config: DeckFormatConfig
): string | null {
  if (mainboardCount < config.mainboardSize) {
    const under = config.mainboardSize - mainboardCount;
    return `${under} card${under === 1 ? '' : 's'} short of the ${config.label} size (${config.mainboardSize})`;
  }
  return null;
}

/**
 * A generated singleton deck's land count is checked against a floor well
 * BELOW the format's real manabase range (Commander runs 32-42 lands — see
 * DECK_FORMAT_CONFIGS' landRange / the DeckCustomizer slider, min 32). This
 * exists only to catch an actual generation bug (e.g. a land-count clamp
 * regression producing a near-landless 100-card deck) — never to second-guess
 * a legitimately aggressive low-land build, so it sits well under the ideal
 * band: 25 of 99 mainboard slots (~25%) for Commander/PDH, scaled
 * proportionally for smaller singleton formats (Brawl, Brawl-40).
 */
export const GENERATED_LAND_FLOOR_RATIO = 25 / 99;

export function validateGeneratedLandFloor(
  landCount: number,
  config: DeckFormatConfig
): string | null {
  if (!config.isSingleton) return null; // floor only meaningful for singleton/commander-style generation
  const floor = Math.round(config.mainboardSize * GENERATED_LAND_FLOOR_RATIO);
  if (landCount < floor) {
    return `Only ${landCount} land${landCount === 1 ? '' : 's'} — below the ${floor}-land floor for a ${config.mainboardSize}-card singleton deck`;
  }
  return null;
}

/**
 * Hard validation gate for a freshly GENERATED deck, run once before it's
 * ever saved (see use-deck-generation.ts). Wraps the display-facing
 * validateDeck (legality / color-identity / copy-limit) and validateDeckSize
 * (over-size) with the two checks that only make sense in a generation
 * context — under-size and the land floor — so generation-time failures are
 * caught before createDeck ever runs, not just flagged afterward on the
 * saved deck's display badge.
 *
 * Companions are NOT modeled anywhere in this codebase (no companion
 * legality concept exists in ScryfallCard/DeckFormatConfig) — deliberately
 * out of scope here too, not an oversight.
 */
export function validateGeneratedDeck(
  mainboardCards: ScryfallCard[],
  config: DeckFormatConfig,
  options: {
    commander?: ScryfallCard | null;
    partnerCommander?: ScryfallCard | null;
  } = {}
): LegalityIssue[] {
  const asDeckCards: DeckCard[] = mainboardCards.map((card, i) => ({
    slotId: `gen-${i}`,
    card,
    allocatedCopyId: null,
  }));

  const issues = validateDeck(asDeckCards, [], config, options);

  const overSize = validateDeckSize(mainboardCards.length, config);
  if (overSize) {
    issues.push({
      slotId: SIZE_SLOT_ID,
      cardName: config.label,
      issue: 'over-size',
      detail: overSize,
    });
  }

  const underSize = validateGeneratedDeckUnderSize(mainboardCards.length, config);
  if (underSize) {
    issues.push({
      slotId: SIZE_SLOT_ID,
      cardName: config.label,
      issue: 'under-size',
      detail: underSize,
    });
  }

  const landCount = mainboardCards.filter(isLand).length;
  const landFloor = validateGeneratedLandFloor(landCount, config);
  if (landFloor) {
    issues.push({
      slotId: LAND_FLOOR_SLOT_ID,
      cardName: config.label,
      issue: 'land-floor',
      detail: landFloor,
    });
  }

  return issues;
}
