import { useMemo, useState, type ReactNode } from 'react';
import type { PublicCard } from '../../lib/shared-types';
import type { ChipExpression } from '../../types';
import type { SetMap } from '../../lib/api';
import { CollectionFiltersDialog } from '../CollectionFiltersDialog';
import { useCardTagsReady } from '../../lib/card-tags';
import { isExpressionEmpty } from '../../lib/rules';
import {
  countActiveSharedFilters,
  makeSharedMatcher,
  type SharedFilterState,
} from '../../lib/shared-filter';

const EMPTY_EXPR: ChipExpression = { chips: [], joiners: [] };

const COLOR_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'W', label: 'White' },
  { key: 'U', label: 'Blue' },
  { key: 'B', label: 'Black' },
  { key: 'R', label: 'Red' },
  { key: 'G', label: 'Green' },
  { key: 'C', label: 'Colorless' },
];

const RARITIES = ['mythic', 'rare', 'uncommon', 'common'] as const;

/** Subtype suggestions derived from the share's own type lines (offline, no API). */
function subtypesFrom(cards: PublicCard[]): string[] {
  const set = new Set<string>();
  for (const c of cards) {
    const tl = c.typeLine ?? '';
    const dash = tl.indexOf('—');
    if (dash < 0) continue;
    for (const w of tl
      .slice(dash + 1)
      .trim()
      .split(/\s+/))
      if (w) set.add(w);
  }
  return [...set].sort();
}

/** Minimal SetMap (keyed by UPPERCASE code) scoped to the sets present in the share. */
function setMapFrom(cards: PublicCard[]): SetMap {
  const map: SetMap = {};
  for (const c of cards) {
    const code = c.setCode.toUpperCase();
    if (!map[code]) {
      map[code] = { code: c.setCode, name: c.setName || c.setCode, iconSvgUri: '', releasedAt: '' };
    }
  }
  return map;
}

/**
 * Shared-view filter: the SAME `CollectionFiltersDialog` the authed collection
 * uses. The public share payload now carries every field the filter matches on
 * (oracle text, format legality, treatment, border — added alongside type line,
 * color, rarity, oracle tags, layout, finish, set, mana value, and — for
 * collection/binder shares — price), so the full facet set is exposed.
 *
 * Returns the wired dialog node (drop into a SearchPill `trailing` slot) plus a
 * `matches` predicate over `PublicCard`, backed by the shared binder-routing
 * engine. Store-agnostic — no zustand.
 */
export function useSharedFilters(
  cards: PublicCard[],
  opts: { withPrice?: boolean } = {}
): { filterNode: ReactNode; matches: (pc: PublicCard) => boolean } {
  const withPrice = opts.withPrice ?? true;

  const [supertypeExpr, setSupertypeExpr] = useState<ChipExpression>(EMPTY_EXPR);
  const [typesExpr, setTypesExpr] = useState<ChipExpression>(EMPTY_EXPR);
  const [subtypeExpr, setSubtypeExpr] = useState<ChipExpression>(EMPTY_EXPR);
  const [colorFilter, setColorFilter] = useState<Set<string>>(new Set());
  const [rarityExpr, setRarityExpr] = useState<ChipExpression>(EMPTY_EXPR);
  const [oracleExpr, setOracleExpr] = useState<ChipExpression>(EMPTY_EXPR);
  const [oracleTagExpr, setOracleTagExpr] = useState<ChipExpression>(EMPTY_EXPR);
  const [legalityExpr, setLegalityExpr] = useState<ChipExpression>(EMPTY_EXPR);
  const [layoutExpr, setLayoutExpr] = useState<ChipExpression>(EMPTY_EXPR);
  const [treatmentExpr, setTreatmentExpr] = useState<ChipExpression>(EMPTY_EXPR);
  const [borderExpr, setBorderExpr] = useState<ChipExpression>(EMPTY_EXPR);
  const [finishExpr, setFinishExpr] = useState<ChipExpression>(EMPTY_EXPR);
  const [setFilter, setSetFilter] = useState<Set<string>>(new Set());
  const [cmcMin, setCmcMin] = useState<number | undefined>(undefined);
  const [cmcMax, setCmcMax] = useState<number | undefined>(undefined);
  const [priceMin, setPriceMin] = useState<number | undefined>(undefined);
  const [priceMax, setPriceMax] = useState<number | undefined>(undefined);

  // Load the oracle-tag snapshot only when a tag filter is active; `tagsReady`
  // flips once on load and rebuilds the matcher so tags decorate correctly.
  const tagsReady = useCardTagsReady(!isExpressionEmpty(oracleTagExpr));

  const subtypeSuggestions = useMemo(() => subtypesFrom(cards), [cards]);
  const setMap = useMemo(() => setMapFrom(cards), [cards]);

  const state: SharedFilterState = {
    supertypeExpr,
    typesExpr,
    subtypeExpr,
    colorFilter,
    rarityExpr,
    oracleExpr,
    oracleTagExpr,
    legalityExpr,
    layoutExpr,
    treatmentExpr,
    borderExpr,
    finishExpr,
    setFilter,
    cmcMin,
    cmcMax,
    priceMin: withPrice ? priceMin : undefined,
    priceMax: withPrice ? priceMax : undefined,
  };

  const matches = useMemo(
    () => makeSharedMatcher(state),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- state is a fresh object each render; depend on its fields + tag readiness
    [
      supertypeExpr,
      typesExpr,
      subtypeExpr,
      colorFilter,
      rarityExpr,
      oracleExpr,
      oracleTagExpr,
      legalityExpr,
      layoutExpr,
      treatmentExpr,
      borderExpr,
      finishExpr,
      setFilter,
      cmcMin,
      cmcMax,
      priceMin,
      priceMax,
      withPrice,
      tagsReady,
    ]
  );

  const activeCount = countActiveSharedFilters(state);

  const filterNode = (
    <CollectionFiltersDialog
      supertypeExpr={supertypeExpr}
      setSupertypeExpr={setSupertypeExpr}
      typesExpr={typesExpr}
      setTypesExpr={setTypesExpr}
      subtypeExpr={subtypeExpr}
      setSubtypeExpr={setSubtypeExpr}
      subtypeSuggestions={subtypeSuggestions}
      colorFilter={colorFilter}
      setColorFilter={setColorFilter}
      colorOptions={COLOR_OPTIONS}
      rarityExpr={rarityExpr}
      setRarityExpr={setRarityExpr}
      rarities={RARITIES}
      oracleExpr={oracleExpr}
      setOracleExpr={setOracleExpr}
      oracleTagExpr={oracleTagExpr}
      setOracleTagExpr={setOracleTagExpr}
      legalityExpr={legalityExpr}
      setLegalityExpr={setLegalityExpr}
      layoutExpr={layoutExpr}
      setLayoutExpr={setLayoutExpr}
      treatmentExpr={treatmentExpr}
      setTreatmentExpr={setTreatmentExpr}
      borderExpr={borderExpr}
      setBorderExpr={setBorderExpr}
      finishExpr={finishExpr}
      setFinishExpr={setFinishExpr}
      setFilter={setFilter}
      setSetFilter={setSetFilter}
      setMap={setMap}
      cmcMin={cmcMin}
      setCmcMin={setCmcMin}
      cmcMax={cmcMax}
      setCmcMax={setCmcMax}
      {...(withPrice ? { priceMin, setPriceMin, priceMax, setPriceMax } : {})}
      activeCount={activeCount}
    />
  );

  return { filterNode, matches };
}
