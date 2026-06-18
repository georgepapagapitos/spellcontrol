import { Pick } from './generate';

/**
 * CubeCobra / Cube Tutor bulk-import format: one card name per line.
 * Paste into CubeCobra's "Add Cards" to draft the generated cube.
 */
export function toCubeCobraList(picks: Pick[]): string {
  return picks
    .map((p) => p.card.name)
    .sort((a, b) => a.localeCompare(b))
    .join('\n');
}
