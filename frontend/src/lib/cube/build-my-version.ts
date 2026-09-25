// "Import a CubeCobra cube → Build my version": keep every card the user
// already owns, and for the rest pick the closest owned substitute. Pure &
// deterministic: same imported list + pool + options → same result.

import { bucketOf, curveSlotOf, type CubeCard } from './core';
import { apportion, byQuality, dedupeByOracle, type GeneratedCube, type Pick } from './generate';
import { CUBE_SIZES, type ColorBucket, type CubeSize } from './targets';
import { targetsForSize } from './targets';
import type { CubeCobraCard, ImportedCube } from './import';
import { COLOR_LABEL } from './swap';
import { cubeRole } from '@/deck-builder/services/tagger/client';

export interface SubstitutedCard {
  original: CubeCobraCard;
  substitute: CubeCard;
  reason: string;
}

export interface BuildMyVersionResult {
  cube: GeneratedCube;
  /** The imported cube's own card count — may differ from `cube.size` (the
   *  closest size we offer); `cube.shortfall` is measured against `cube.size`. */
  requestedSize: number;
  kept: CubeCard[];
  substituted: SubstitutedCard[];
  /** Imported cards with no owned substitute found. */
  missing: CubeCobraCard[];
}

/** Card-type buckets used to match a substitute's shape to the original's. */
const TYPE_SLOTS = [
  'creature',
  'instant',
  'sorcery',
  'artifact',
  'enchantment',
  'planeswalker',
  'land',
  'battle',
] as const;
function primaryType(typeLine: string): string {
  const t = typeLine.toLowerCase();
  return TYPE_SLOTS.find((x) => t.includes(x)) ?? 'other';
}

/** The closest cube size we offer to `n`; ties go to the smaller size. */
function closestCubeSize(n: number): CubeSize {
  return CUBE_SIZES.reduce((best, s) => {
    const d = Math.abs(s - n);
    const bestD = Math.abs(best - n);
    return d < bestD || (d === bestD && s < best) ? s : best;
  });
}

/** A CubeCobra import card carries no role — derive it from the same tagger
 *  `namesToCubePool` uses, so imported and owned cards match on a shared basis. */
function toMatchable(c: CubeCobraCard): CubeCard {
  return {
    name: c.name,
    oracleId: c.oracleId,
    colors: c.colors,
    cmc: c.cmc,
    typeLine: c.typeLine,
    role: cubeRole(c.name),
  };
}

// No "Substitute for X:" prefix — every caller shows this next to the
// original card it's replacing, so naming it again is redundant.
function substituteReason(sub: CubeCard): string {
  const bucket = bucketOf(sub);
  const color = COLOR_LABEL[bucket] ?? bucket;
  const slot = curveSlotOf(sub.cmc);
  const slotLabel = slot === '7' ? '7+' : slot;
  return `${color.charAt(0).toUpperCase()}${color.slice(1)}, ${slotLabel} mana`;
}

export function buildMyVersion(
  imported: ImportedCube,
  pool: CubeCard[],
  options?: { banned?: string[] }
): BuildMyVersionResult {
  const bannedSet = new Set(options?.banned ?? []);
  const requestedSize = imported.cards.length;
  const size = closestCubeSize(requestedSize);

  // Dedupe the imported list by oracleId (keep first) so the output is
  // singleton even if the source cube listed a card twice.
  const seenImportIds = new Set<string>();
  const importList = imported.cards.filter((c) => {
    if (!c.oracleId) return true; // unknown identity — can't dedupe, can't own either
    if (seenImportIds.has(c.oracleId)) return false;
    seenImportIds.add(c.oracleId);
    return true;
  });

  const ownedPool = dedupeByOracle(pool.filter((c) => !bannedSet.has(c.oracleId)));
  const ownedByOracle = new Map(ownedPool.map((c) => [c.oracleId, c]));

  const used = new Set<string>();
  const kept: CubeCard[] = [];
  const needsSub: CubeCobraCard[] = [];
  for (const c of importList) {
    const owned =
      c.oracleId && !bannedSet.has(c.oracleId) ? ownedByOracle.get(c.oracleId) : undefined;
    if (owned) {
      kept.push(owned);
      used.add(owned.oracleId);
    } else {
      needsSub.push(c);
    }
  }

  const substituted: SubstitutedCard[] = [];
  const missing: CubeCobraCard[] = [];
  for (const original of needsSub) {
    const shape = toMatchable(original);
    const bucket = bucketOf(shape);
    const type = primaryType(shape.typeLine);
    const slot = Number(curveSlotOf(shape.cmc));
    const role = shape.role;

    const candidates = ownedPool.filter(
      (c) =>
        !used.has(c.oracleId) &&
        bucketOf(c) === bucket &&
        primaryType(c.typeLine) === type &&
        Math.abs(Number(curveSlotOf(c.cmc)) - slot) <= 1
    );
    candidates.sort((a, b) => {
      const slotDist = (c: CubeCard) => Math.abs(Number(curveSlotOf(c.cmc)) - slot);
      const roleRank = (c: CubeCard) => (role && c.role === role ? 0 : 1);
      return slotDist(a) - slotDist(b) || roleRank(a) - roleRank(b) || byQuality(a, b);
    });

    const sub = candidates[0];
    if (!sub) {
      missing.push(original);
      continue;
    }
    used.add(sub.oracleId);
    substituted.push({ original, substitute: sub, reason: substituteReason(sub) });
  }

  const picks: Pick[] = [
    ...kept.map((card) => ({
      card,
      bucket: bucketOf(card),
      reason: 'Owned, kept from the import',
    })),
    ...substituted.map((s) => ({
      card: s.substitute,
      bucket: bucketOf(s.substitute),
      reason: s.reason,
    })),
  ];

  const byBucket = {} as Record<ColorBucket, number>;
  const buckets: ColorBucket[] = ['W', 'U', 'B', 'R', 'G', 'multicolor', 'colorless', 'land'];
  for (const b of buckets) byBucket[b] = 0;
  for (const p of picks) byBucket[p.bucket]++;

  const band = targetsForSize(size, 'limited');
  const shares = {} as Record<ColorBucket, number>;
  for (const b of buckets) shares[b] = band.color[b].median;
  const targetByBucket = apportion(shares, size);

  const shortfall = Math.max(0, size - picks.length);
  const gaps: GeneratedCube['gaps'] =
    missing.length > 0
      ? [
          {
            severity: 'short',
            text: `${missing.length} card${missing.length === 1 ? '' : 's'} from the import have no owned match in the same slot. Add them to your collection, or accept the cube without them.`,
          },
        ]
      : [];

  const cube: GeneratedCube = {
    size,
    format: 'limited',
    picks,
    byBucket,
    targetByBucket,
    gaps,
    shortfall,
    poolSize: ownedPool.length,
  };

  return { cube, requestedSize, kept, substituted, missing };
}
