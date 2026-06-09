import type { CardToken, ScryfallCard } from '@/deck-builder/types';

/** One row in a deck's token-prep checklist. */
export interface DeckToken {
  /** Token name as Scryfall lists it (e.g. "Treasure", "Goblin", "Copy"). */
  name: string;
  /**
   * Scryfall token type line, e.g. "Token Creature — Goblin",
   * "Token Artifact — Treasure", or "Emblem". Absent on the rare token entry
   * that carries no type line.
   */
  typeLine?: string;
  /** Distinct deck cards that can create this token, sorted alphabetically. */
  producers: string[];
}

const norm = (s: string): string => s.trim();

/**
 * The tokens a card creates, from whichever source the card carries:
 *   - `tokens`: pre-distilled on the offline slim bundle (native).
 *   - `all_parts`: raw Scryfall relationships on a live-resolved card (web) —
 *     we keep only the `component === 'token'` entries here.
 * Prefer the pre-distilled field; fall back to all_parts.
 */
function cardTokens(card: ScryfallCard): CardToken[] {
  if (card.tokens && card.tokens.length > 0) return card.tokens;
  if (card.all_parts && card.all_parts.length > 0) {
    const out: CardToken[] = [];
    for (const p of card.all_parts) {
      if (p.component !== 'token' || !p.name) continue;
      out.push(p.type_line ? { name: p.name, typeLine: p.type_line } : { name: p.name });
    }
    return out;
  }
  return [];
}

/**
 * Build a deduped checklist of every token (and emblem) a deck can create, so
 * the user can prep the physical tokens before a game.
 *
 * Each card's `tokens` come from Scryfall's `all_parts` relationship array
 * (only the `component === 'token'` entries), threaded through the offline slim
 * payload. We group by token name + type line and record which distinct deck
 * cards produce each one.
 *
 * Pure and deterministic: rows are ordered most-produced first, then by name.
 * A card that appears multiple times in the deck (e.g. four copies in a 60-card
 * deck) counts as a single producer.
 */
export function aggregateDeckTokens(cards: ScryfallCard[]): DeckToken[] {
  const groups = new Map<string, { name: string; typeLine?: string; producers: Set<string> }>();

  for (const card of cards) {
    const tokens = cardTokens(card);
    if (tokens.length === 0) continue;
    const producer = norm(card.name);
    if (!producer) continue;

    // A single card can list the same token more than once — dedupe per card so
    // it never inflates its own producer entry.
    const seenForCard = new Set<string>();
    for (const t of tokens) {
      const name = norm(t.name);
      if (!name) continue;
      const typeLine = t.typeLine ? norm(t.typeLine) : undefined;
      const key = `${name} ${typeLine ?? ''}`;
      if (seenForCard.has(key)) continue;
      seenForCard.add(key);

      let group = groups.get(key);
      if (!group) {
        group = { name, typeLine, producers: new Set<string>() };
        groups.set(key, group);
      }
      group.producers.add(producer);
    }
  }

  return [...groups.values()]
    .map((g) => ({
      name: g.name,
      typeLine: g.typeLine,
      producers: [...g.producers].sort((a, b) => a.localeCompare(b)),
    }))
    .sort(
      (a, b) =>
        b.producers.length - a.producers.length ||
        a.name.localeCompare(b.name) ||
        (a.typeLine ?? '').localeCompare(b.typeLine ?? '')
    );
}
