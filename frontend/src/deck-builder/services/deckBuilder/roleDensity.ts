import { getAllCardRoles, type RoleKey } from '@/deck-builder/services/tagger/client';

export type RoleDensity = Record<RoleKey, number>;

function frontTypeLine(card: {
  type_line?: string;
  card_faces?: Array<{ type_line?: string }>;
}): string {
  return card.card_faces?.[0]?.type_line || card.type_line || '';
}

/**
 * Overlapping role counts: each non-land card counts toward **every** role it
 * fills (via `getAllCardRoles`), so a Mystic Confluence lands in both Draw and
 * Removal. Totals deliberately exceed the card count — the point is to show how
 * much of the deck pulls double duty.
 *
 * Contrast `computeRoleCounts` (in commanderDeckAnalysis.ts), which assigns each
 * card a single primary role. Same land-skipping rule so the two stay comparable.
 */
export function computeRoleDensity(
  cards: Array<{ name: string; type_line?: string; card_faces?: Array<{ type_line?: string }> }>
): RoleDensity {
  const density: RoleDensity = { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 };
  for (const c of cards) {
    if (frontTypeLine(c).toLowerCase().includes('land')) continue;
    for (const role of getAllCardRoles(c.name)) {
      density[role] += 1;
    }
  }
  return density;
}
