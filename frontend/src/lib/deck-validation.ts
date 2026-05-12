import type { ScryfallCard, DeckFormatConfig } from '@/deck-builder/types';
import type { DeckCard } from '@/store/decks';

const BASIC_LAND_NAMES = new Set([
  'Plains',
  'Island',
  'Swamp',
  'Mountain',
  'Forest',
  'Wastes',
  'Snow-Covered Plains',
  'Snow-Covered Island',
  'Snow-Covered Swamp',
  'Snow-Covered Mountain',
  'Snow-Covered Forest',
]);

type LegalityIssueKind = 'not-legal' | 'over-copy-limit' | 'color-identity';

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
