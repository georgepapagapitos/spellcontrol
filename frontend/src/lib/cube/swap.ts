// Ranked replacement candidates for one pick in a generated cube — the "Swap"
// action on the cube edit page. Pure: same cube + pool + options → same list.

import { bucketOf, curveSlotOf, type CubeCard } from './core';
import { byQuality, type GeneratedCube } from './generate';

export interface SwapCandidate {
  card: CubeCard;
  reason: string;
}

export const COLOR_LABEL: Record<string, string> = {
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green',
  multicolor: 'multicolor',
  colorless: 'colorless',
  land: 'land',
};

function candidateReason(c: CubeCard, targetSlotNum: number): string {
  const slotNum = Number(curveSlotOf(c.cmc));
  const sameSlot = slotNum === targetSlotNum;
  const slotLabel = slotNum === 7 ? '7+' : `${slotNum}`;
  const kind = c.role ?? (/\bcreature\b/i.test(c.typeLine) ? 'creature' : 'spell');
  const color = COLOR_LABEL[bucketOf(c)] ?? bucketOf(c);
  return `${sameSlot ? 'Same slot' : 'Close slot'}: ${color}, ${slotLabel} mana, ${kind}`;
}

/**
 * Ranked replacements for `cube.picks[pickIndex]`: owned cards not already in
 * the cube and not banned, in the same color bucket, curve slot first then
 * ±1, same role preferred when the pick has one, ordered by the generator's
 * quality order (`byQuality`).
 */
export function swapCandidates(
  cube: GeneratedCube,
  pickIndex: number,
  pool: CubeCard[],
  options?: { banned?: string[]; n?: number }
): SwapCandidate[] {
  const target = cube.picks[pickIndex];
  if (!target) return [];
  const n = options?.n ?? 8;
  const bannedSet = new Set(options?.banned ?? []);
  const inCube = new Set(cube.picks.map((p) => p.card.oracleId));
  const targetBucket = target.bucket;
  const targetSlot = Number(curveSlotOf(target.card.cmc));
  const targetRole = target.card.role;

  const candidates = pool.filter(
    (c) =>
      !inCube.has(c.oracleId) &&
      !bannedSet.has(c.oracleId) &&
      bucketOf(c) === targetBucket &&
      Math.abs(Number(curveSlotOf(c.cmc)) - targetSlot) <= 1
  );

  candidates.sort((a, b) => {
    const slotDist = (c: CubeCard) => Math.abs(Number(curveSlotOf(c.cmc)) - targetSlot);
    const roleRank = (c: CubeCard) => (targetRole && c.role === targetRole ? 0 : 1);
    return slotDist(a) - slotDist(b) || roleRank(a) - roleRank(b) || byQuality(a, b);
  });

  return candidates
    .slice(0, n)
    .map((card) => ({ card, reason: candidateReason(card, targetSlot) }));
}
