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

export interface LegalityIssue {
  slotId: string;
  cardName: string;
  issue: 'not-legal' | 'over-copy-limit';
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

export function validateDeck(
  cards: DeckCard[],
  sideboard: DeckCard[],
  config: DeckFormatConfig
): LegalityIssue[] {
  const issues: LegalityIssue[] = [];

  const allCards = [
    ...cards.map((c) => ({ ...c, zone: 'main' as const })),
    ...sideboard.map((c) => ({ ...c, zone: 'side' as const })),
  ];

  // Check legality
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

  // Check copy limits (count across main + side combined)
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
