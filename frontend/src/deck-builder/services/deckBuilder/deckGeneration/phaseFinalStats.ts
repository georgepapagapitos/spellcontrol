import type { DeckStats } from '@/deck-builder/types';
import { fetchSaltIndex } from '@/deck-builder/services/edhrec/client';
import { getFrontFaceTypeLine } from '@/deck-builder/services/scryfall/client';
import { calculateStats } from '../deckStats';
import type { GenerationState } from './state';

// Calculate final deck stats + salt stats. Verbatim extraction from
// generateDeck: `categories` -> `state.categories`. `saltIndex` is passed in
// by value: the block reassigns it (lazy salt-index load) but nothing reads
// saltIndex after this block in generateDeck, so the reassignment never needs
// to propagate back — behavior-identical. Async (awaits fetchSaltIndex).
export async function finalStatsPhase(
  state: GenerationState,
  saltIndex: Map<string, number>
): Promise<DeckStats> {
  // Calculate stats
  const stats = calculateStats(state.categories);

  // Compute salt stats from the salt index (top-100 saltiest from EDHREC).
  // We load it here as well if it wasn't already (e.g. saltTolerance === 'any').
  if (!saltIndex.size) saltIndex = await fetchSaltIndex();
  if (saltIndex.size > 0) {
    const nonLandCards = Object.values(state.categories)
      .flat()
      .filter((c) => !getFrontFaceTypeLine(c).toLowerCase().includes('land'));

    const saltyCards: Array<{ name: string; salt: number }> = [];
    let saltSum = 0;
    for (const card of nonLandCards) {
      const key = card.name.includes(' // ') ? card.name.split(' // ')[0] : card.name;
      const salt = saltIndex.get(card.name) ?? saltIndex.get(key) ?? 0;
      saltSum += salt;
      if (salt > 0) saltyCards.push({ name: card.name, salt });
    }
    if (nonLandCards.length > 0) {
      stats.averageSalt = Math.round((saltSum / nonLandCards.length) * 100) / 100;
      stats.saltiestCards = saltyCards
        .sort((a, b) => b.salt - a.salt)
        .slice(0, 5)
        .map((c) => ({ name: c.name, salt: Math.round(c.salt * 100) / 100 }));
    }
  }

  return stats;
}
