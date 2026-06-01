import { getAllCardRoles, type RoleKey } from '@/deck-builder/services/tagger/client';

export type RoleDensity = Record<RoleKey, number>;

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
  cards: Array<{ name: string; type_line?: string }>
): RoleDensity {
  const density: RoleDensity = { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 };
  for (const c of cards) {
    if ((c.type_line || '').toLowerCase().includes('land')) continue;
    for (const role of getAllCardRoles(c.name)) {
      density[role] += 1;
    }
  }
  return density;
}
