import type { BinderFilter, ChipExpression, NegatableChip } from '../types';

/**
 * Normalize a draft `BinderFilter` for persistence: strip blank-value chips,
 * trim strings, and drop empty/undefined fields so an absent constraint stays
 * absent.
 *
 * ⚠️ This is a **field whitelist** — every persistable `BinderFilter` field
 * must be copied here explicitly. A new field added to `BinderFilter` that is
 * NOT added here is silently dropped on save (the editor's live preview reads
 * the in-memory draft and looks correct, but the reloaded binder loses the
 * constraint). `clean-filter.test.ts` guards this.
 */
export function cleanFilter(f: BinderFilter): BinderFilter {
  const out: BinderFilter = {};
  /**
   * Strip blank-value chips, dropping the field entirely when nothing's
   * left. Joiners stay in lockstep with surviving chips: joiners[i]
   * connects chips[i]→chips[i+1], so when chip i is removed we drop
   * joiner i (the one *after* it) — preserving the leading-no-joiner
   * invariant.
   */
  const cleanField = (expr?: ChipExpression): ChipExpression | undefined => {
    if (!expr) return undefined;
    const keepIdx: number[] = [];
    const keptChips: NegatableChip[] = [];
    expr.chips.forEach((c, i) => {
      if (c.value.trim()) {
        keepIdx.push(i);
        keptChips.push({ value: c.value.trim(), negate: c.negate });
      }
    });
    if (keptChips.length === 0) return undefined;
    const keptJoiners: ('AND' | 'OR')[] = [];
    for (let k = 0; k < keepIdx.length - 1; k++) {
      keptJoiners.push(expr.joiners[keepIdx[k]] ?? 'AND');
    }
    return { chips: keptChips, joiners: keptJoiners };
  };
  if (cleanField(f.legalities)) out.legalities = cleanField(f.legalities);
  if (cleanField(f.colors)) out.colors = cleanField(f.colors);
  if (cleanField(f.rarities)) out.rarities = cleanField(f.rarities);
  if (cleanField(f.typeChips)) out.typeChips = cleanField(f.typeChips);
  if (cleanField(f.typeTokenChips)) out.typeTokenChips = cleanField(f.typeTokenChips);
  if (cleanField(f.supertypeChips)) out.supertypeChips = cleanField(f.supertypeChips);
  if (cleanField(f.subtypeChips)) out.subtypeChips = cleanField(f.subtypeChips);
  if (cleanField(f.oracleChips)) out.oracleChips = cleanField(f.oracleChips);
  if (cleanField(f.finishes)) out.finishes = cleanField(f.finishes);
  if (cleanField(f.layouts)) out.layouts = cleanField(f.layouts);
  if (cleanField(f.treatments)) out.treatments = cleanField(f.treatments);
  if (cleanField(f.borderColors)) out.borderColors = cleanField(f.borderColors);

  if (f.cmcMin !== undefined && !isNaN(f.cmcMin)) out.cmcMin = f.cmcMin;
  if (f.cmcMax !== undefined && !isNaN(f.cmcMax)) out.cmcMax = f.cmcMax;
  if (f.manaCost?.trim()) out.manaCost = f.manaCost.trim();
  if (f.setCodes && f.setCodes.length) out.setCodes = f.setCodes.map((s) => s.toUpperCase());
  if (f.priceMin !== undefined && !isNaN(f.priceMin)) out.priceMin = f.priceMin;
  if (f.priceMax !== undefined && !isNaN(f.priceMax)) out.priceMax = f.priceMax;
  if (f.nameContains?.trim()) out.nameContains = f.nameContains.trim();
  if (f.edhrecRankMax !== undefined && !isNaN(f.edhrecRankMax)) out.edhrecRankMax = f.edhrecRankMax;
  if (f.commanderEligible !== undefined) out.commanderEligible = f.commanderEligible;
  return out;
}
