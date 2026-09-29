import type { RefineCard } from './ai-refine';

/**
 * Map each pool card to the other pool cards that fill the SAME role, best
 * first, so a proposed swap can be re-rolled against the engine's own ranking
 * without another model call.
 *
 * Pool order is preserved rather than re-sorted: `buildRefinePool` (ai-refine.ts)
 * emits gaps → off-meta synergy → owned substitutes → hidden gems → land
 * upgrades on purpose, so the most staple-like candidates come first — a
 * re-roll should hand back that same "best next" ordering, not an arbitrary one.
 *
 * `roleOf` is injected rather than imported so this module has zero tagger/
 * browser-state dependency and stays pure and testable — the same fix pattern
 * as `@spellcontrol/deck-metrics`'s injected `TagLookup`, after a hard tagger
 * import there failed silently server-side.
 */
export function buildAlternativeIndex(
  pool: RefineCard[],
  roleOf: (name: string) => string | null
): Map<string, string[]> {
  const byRole = new Map<string, string[]>();
  const roleByName = new Map<string, string | null>();

  for (const card of pool) {
    if (roleByName.has(card.name)) continue;
    const role = roleOf(card.name);
    roleByName.set(card.name, role);
    if (role === null) continue;
    const group = byRole.get(role);
    if (group) group.push(card.name);
    else byRole.set(role, [card.name]);
  }

  const index = new Map<string, string[]>();
  for (const [name, role] of roleByName) {
    if (role === null) {
      index.set(name, []);
      continue;
    }
    const group = byRole.get(role) ?? [];
    index.set(
      name,
      group.filter((n) => n !== name)
    );
  }
  return index;
}
