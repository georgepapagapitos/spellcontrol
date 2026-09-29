import type {
  BinderDef,
  BinderFilterGroup,
  BinderInput,
  EnrichedCard,
  MaterializedBinder,
} from '@/types/index';
import { compileFilterGroups, cardMatchesCompiled } from './rules';
import type { BinderLayoutInputs } from './use-binder-layout-inputs';
import { materializeBinders } from './materialize';

/** Stand-in id for a binder that has no id yet (a brand-new draft). Shared by
 *  every draft-substitution pass (landing counts, the ladder, the live
 *  preview) so they can all recognize the same slot as "this binder". */
export const DRAFT_BINDER_ID = '__draft__';

/** Ladder-only id for the catch-all bucket — never a real BinderDef id. */
export const UNCATEGORIZED_LADDER_ID = '__uncategorized__';

/**
 * "Staples", "Staples and Rares", or "Staples and 3 others" — names the binders
 * outbidding this one instead of the anonymous "binders above this one" (E298).
 * Two names is the readable ceiling for an inline sentence; beyond that the
 * count carries it and the binder list itself shows the order.
 */
export function formatCaughtBy(
  caughtBy: { binderName: string; count: number }[],
  fallback = 'binders above this one'
): string {
  if (caughtBy.length === 0) return fallback;
  if (caughtBy.length === 1) return caughtBy[0].binderName;
  if (caughtBy.length === 2) return `${caughtBy[0].binderName} and ${caughtBy[1].binderName}`;
  return `${caughtBy[0].binderName} and ${caughtBy.length - 1} others`;
}

/** One rung of the binder ladder ("a card goes to the first binder that wants
 *  it"), in waterfall (position) order, Uncategorized always last. */
export interface LadderEntry {
  id: string;
  name: string;
  /** null for Uncategorized — rendered as a dashed outline, never a color. */
  color: string | null;
  count: number;
  isDraft: boolean;
}

/** Position a substituted draft def takes in the waterfall: an edited binder
 *  keeps its slot, a new one goes last, and a pending "Move above X" previews
 *  it half a step ahead of that target. Shared by every draft-substitution
 *  pass so they can never disagree about where the draft sits. */
function draftPosition(
  allBinders: BinderDef[],
  existingIdx: number,
  placeAbove: BinderDef | undefined
): number {
  if (placeAbove !== undefined) return placeAbove.position - 0.5;
  if (existingIdx !== -1) return allBinders[existingIdx].position;
  const maxPosition = allBinders.reduce((m, b) => Math.max(m, b.position), -1);
  return maxPosition + 1;
}

export interface BinderCounts {
  /**
   * Per-OR-group raw rule-match counts. Promotion-agnostic on purpose:
   * "keep all printings together" is a binder-level effect, so promoted
   * copies can't be attributed to a specific group.
   */
  perGroup: number[];
  /**
   * Deduped binder-size estimate for the editor.
   *
   * Without `keepPrintingsTogether`: number of owned copies matching ≥1 group.
   *
   * With `keepPrintingsTogether`: expands to every owned copy that shares an
   * `oracleId` with a rule-matched card (matching `materializeBinders`'s
   * promotion grouping), plus matched copies that have no `oracleId` (can't be
   * grouped, but they matched so they're in). This is an **upper bound** — it
   * ignores cross-binder routing/priority, exactly like the rest of the
   * editor's in-isolation estimate, and over-estimating is the safe direction
   * for the over-capacity warning.
   */
  total: number;
}

/**
 * Computes the editor's per-group and total match counts for a binder's
 * draft rules. Pure; mirrors the membership logic in `materializeBinders`.
 */
export function countBinderMatches(
  cards: EnrichedCard[],
  groups: BinderFilterGroup[],
  keepPrintingsTogether: boolean
): BinderCounts {
  const compiled = compileFilterGroups(groups);
  const perGroup = new Array(compiled.length).fill(0) as number[];
  const matchedOracleIds = new Set<string>();
  let matchedNoOracle = 0;
  let plainTotal = 0;
  for (const card of cards) {
    let any = false;
    for (let i = 0; i < compiled.length; i++) {
      if (cardMatchesCompiled(card, compiled[i])) {
        perGroup[i]++;
        any = true;
      }
    }
    if (any) {
      plainTotal++;
      if (card.oracleId !== undefined) matchedOracleIds.add(card.oracleId);
      else matchedNoOracle++;
    }
  }
  if (!keepPrintingsTogether) return { perGroup, total: plainTotal };

  let expanded = matchedNoOracle;
  for (const card of cards) {
    if (card.oracleId !== undefined && matchedOracleIds.has(card.oracleId)) expanded++;
  }
  return { perGroup, total: expanded };
}

/** The draft binder-editor state needed to preview waterfall placement. */
export interface DraftBinder {
  /** null for a not-yet-saved binder. */
  id: string | null;
  groups: BinderFilterGroup[];
  keepPrintingsTogether: boolean;
  mode?: 'rules' | 'manual';
  /** Preview the draft just above this binder instead of where it sits (an
   *  existing binder) or last (a new one). The editor's "Move above" fix. */
  placeAboveId?: string | null;
  /** For the ladder's own rung — the tab color the user picked and the name
   *  they're typing, so its swatch and "N others" attribution read true even
   *  before Save. Optional: callers that only want the counts (not the
   *  ladder) can omit them. */
  name?: string;
  color?: string;
}

export interface EffectiveLandingCounts {
  /** Raw rule-match count (see `countBinderMatches`'s `total` with
   *  `keepPrintingsTogether: false`) — waterfall-blind, same figure the
   *  per-group badges already show. Kept separate from `lands` so the UI can
   *  show both "matches the rules" and "actually lands here". */
  matches: number;
  /** What `materializeBinders` actually seats in this binder once the full
   *  binder list (in position order) and `keepPrintingsTogether` promotion
   *  are accounted for. */
  lands: number;
  /** How many of `matches` were claimed by a higher-priority binder instead. */
  caughtAbove: number;
  /** WHICH binders took them, biggest share first. `caughtAbove` alone told
   *  the user their rules were being outbid without saying by whom, which
   *  left the only fix ("move this binder up, or tighten the one that's
   *  catching them") a guess — first-match-wins is the single most common
   *  cause of "why isn't this card in here" (E298). */
  caughtBy: { binderId: string; binderName: string; count: number }[];
  /** How many of `lands` arrived via `keepPrintingsTogether` promotion rather
   *  than matching this binder's own rules. */
  pulledIn: number;
  /** The full waterfall, in position order, Uncategorized last — "a card goes
   *  to the first binder that wants it". Counts come from the SAME rules-only
   *  materialize pass as `caughtBy`/`caughtAbove`, so the binder ladder can
   *  never disagree with them. */
  ladder: LadderEntry[];
  /** The id `ladder` (and every other draft-substitution result) uses for
   *  "this binder" — `draft.id`, or `DRAFT_BINDER_ID` for a new one. */
  draftId: string;
}

/**
 * Runs the draft binder's rules through the REAL waterfall (substituted into
 * the full binder list, in position order) so the editor can show the truth:
 * not just "how many cards match my rules" but "how many will actually land
 * here" once binders above it have taken their share.
 *
 * Two materialize passes are run for the draft slot: one with
 * `keepPrintingsTogether` forced off (isolates pure rule routing — this is
 * what "caught by a binder above" means) and one with the draft's actual
 * setting (the true landing count). Diffing `matches`/`lands` against the
 * rules-only pass gives exact `caughtAbove`/`pulledIn` figures rather than a
 * single before/after diff that can't tell "caught above" apart from
 * "promoted in" when both happen at once.
 */
export function countEffectiveLanding(
  cards: EnrichedCard[],
  allBinders: BinderDef[],
  draft: DraftBinder,
  /** The rest of `useBinderLayoutInputs()`, so a binder that hides deck cards
   *  routes here the way BinderPage shows it. */
  layout: Pick<BinderLayoutInputs, 'allocatedCopyIds' | 'setMap'> = {
    allocatedCopyIds: new Set(),
    setMap: undefined,
  }
): EffectiveLandingCounts {
  const matches = countBinderMatches(cards, draft.groups, false).total;

  const draftId = draft.id ?? DRAFT_BINDER_ID;
  const existingIdx = draft.id ? allBinders.findIndex((b) => b.id === draft.id) : -1;
  const placeAbove = draft.placeAboveId
    ? allBinders.find((b) => b.id === draft.placeAboveId)
    : undefined;

  const buildDefs = (keepPrintingsTogether: boolean): BinderDef[] => {
    const now = Date.now();
    const draftDef: BinderDef = {
      id: draftId,
      name: draft.name ?? '',
      position: draftPosition(allBinders, existingIdx, placeAbove),
      filterGroups: draft.groups,
      sorts: [],
      pocketSize: null,
      doubleSided: false,
      fixedCapacity: null,
      color: draft.color ?? '#8a8a8a',
      mode: draft.mode,
      keepPrintingsTogether,
      createdAt: now,
      updatedAt: now,
    };
    return existingIdx === -1
      ? [...allBinders, draftDef]
      : allBinders.map((b, i) => (i === existingIdx ? draftDef : b));
  };

  const materializeFor = (defs: BinderDef[]) =>
    materializeBinders(cards, defs, {
      search: '',
      allocatedCopyIds: layout.allocatedCopyIds,
      setMap: layout.setMap,
    });
  const landsIn = (result: ReturnType<typeof materializeFor>): number =>
    result.binders.find((b) => b.def.id === draftId)?.totalCards ?? 0;

  const rulesOnly = materializeFor(buildDefs(false));
  const rulesOnlyLands = landsIn(rulesOnly);
  const lands = draft.keepPrintingsTogether
    ? landsIn(materializeFor(buildDefs(true)))
    : rulesOnlyLands;

  // Attribute the shortfall: walk the rules-only materialization and count, per
  // OTHER binder, the cards sitting there that the draft's own rules match.
  // Read off the same pass the counts come from, so the attribution can never
  // disagree with the `caughtAbove` total it explains.
  const compiled = compileFilterGroups(draft.groups);
  const caughtBy: EffectiveLandingCounts['caughtBy'] = [];
  for (const b of rulesOnly.binders) {
    if (b.def.id === draftId) continue;
    let count = 0;
    for (const section of b.sections) {
      for (const c of section.cards) {
        if (compiled.some((g) => cardMatchesCompiled(c, g))) count++;
      }
    }
    if (count > 0) caughtBy.push({ binderId: b.def.id, binderName: b.def.name, count });
  }
  caughtBy.sort((a, b) => b.count - a.count || a.binderName.localeCompare(b.binderName));

  // The waterfall, off the SAME rules-only pass: `rulesOnly.binders` is
  // already in position order (materializeBinders sorts before routing), so
  // this can never disagree with `caughtAbove`/`caughtBy` above it.
  const ladder: LadderEntry[] = rulesOnly.binders.map((b) => ({
    id: b.def.id,
    name: b.def.name,
    color: b.def.color,
    count: b.totalCards,
    isDraft: b.def.id === draftId,
  }));
  ladder.push({
    id: UNCATEGORIZED_LADDER_ID,
    name: 'Uncategorized',
    color: null,
    count: rulesOnly.uncategorized.totalCards,
    isDraft: false,
  });

  return {
    matches,
    lands,
    caughtAbove: Math.max(0, matches - rulesOnlyLands),
    pulledIn: Math.max(0, lands - rulesOnlyLands),
    caughtBy,
    ladder,
    draftId,
  };
}

/**
 * Materializes the editor's draft binder with its REAL layout settings (pocket
 * size, sides, sorts, page filling) so the editor's live preview column/strip
 * shows genuine pages, not an approximation. WYSIWYG with Save by construction:
 * `input` is the exact `BinderInput` `handleSave` would persist, so the draft
 * def built here can never drift from what gets written — no second partial
 * chain to keep in sync.
 *
 * `existing` supplies the fields the editor doesn't own (pins, exclusions,
 * manual order) so a manual-mode binder previews its real pinned/manual order
 * rather than an empty slot; undefined for a not-yet-saved binder.
 */
export function materializeDraftPreview(
  cards: EnrichedCard[],
  allBinders: BinderDef[],
  existing: BinderDef | undefined,
  input: BinderInput,
  placeAboveId: string | null | undefined,
  layout: Pick<BinderLayoutInputs, 'allocatedCopyIds' | 'setMap'> = {
    allocatedCopyIds: new Set(),
    setMap: undefined,
  }
): MaterializedBinder {
  const draftId = existing?.id ?? DRAFT_BINDER_ID;
  const existingIdx = existing ? allBinders.findIndex((b) => b.id === existing.id) : -1;
  const placeAbove = placeAboveId ? allBinders.find((b) => b.id === placeAboveId) : undefined;
  const now = Date.now();
  const draftDef: BinderDef = {
    ...(existing ?? { id: draftId, createdAt: now, updatedAt: now }),
    ...input,
    id: draftId,
    position: draftPosition(allBinders, existingIdx, placeAbove),
    updatedAt: now,
  };
  const defs =
    existingIdx === -1
      ? [...allBinders, draftDef]
      : allBinders.map((b, i) => (i === existingIdx ? draftDef : b));
  const result = materializeBinders(cards, defs, {
    search: '',
    allocatedCopyIds: layout.allocatedCopyIds,
    setMap: layout.setMap,
  });
  return (
    result.binders.find((b) => b.def.id === draftId) ?? {
      def: draftDef,
      reasons: new Map(),
      effectivePocketSize: draftDef.pocketSize ?? 9,
      effectiveSorts: draftDef.sorts,
      displaySorts: draftDef.sorts,
      sections: [],
      totalCards: 0,
      totalPages: 0,
      totalValue: 0,
    }
  );
}
