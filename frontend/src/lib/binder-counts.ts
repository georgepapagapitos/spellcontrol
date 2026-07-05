import type { BinderDef, BinderFilterGroup, EnrichedCard } from '../types';
import { compileFilterGroups, cardMatchesCompiled } from './rules';
import { materializeBinders } from './materialize';

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
  /** How many of `lands` arrived via `keepPrintingsTogether` promotion rather
   *  than matching this binder's own rules. */
  pulledIn: number;
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
  draft: DraftBinder
): EffectiveLandingCounts {
  const matches = countBinderMatches(cards, draft.groups, false).total;

  const draftId = draft.id ?? '__draft__';
  const existingIdx = draft.id ? allBinders.findIndex((b) => b.id === draft.id) : -1;
  const maxPosition = allBinders.reduce((m, b) => Math.max(m, b.position), -1);

  const buildDefs = (keepPrintingsTogether: boolean): BinderDef[] => {
    const now = Date.now();
    const draftDef: BinderDef = {
      id: draftId,
      name: '',
      // Editing an existing binder keeps its position (waterfall order
      // unchanged by the preview); a new binder is appended last.
      position: existingIdx === -1 ? maxPosition + 1 : allBinders[existingIdx].position,
      filterGroups: draft.groups,
      sorts: [],
      pocketSize: null,
      doubleSided: false,
      fixedCapacity: null,
      color: '#000000',
      mode: draft.mode,
      keepPrintingsTogether,
      createdAt: now,
      updatedAt: now,
    };
    return existingIdx === -1
      ? [...allBinders, draftDef]
      : allBinders.map((b, i) => (i === existingIdx ? draftDef : b));
  };

  const landingFor = (defs: BinderDef[]): number =>
    materializeBinders(cards, defs, { search: '' }).binders.find((b) => b.def.id === draftId)
      ?.totalCards ?? 0;

  const rulesOnlyLands = landingFor(buildDefs(false));
  const lands = draft.keepPrintingsTogether ? landingFor(buildDefs(true)) : rulesOnlyLands;

  return {
    matches,
    lands,
    caughtAbove: Math.max(0, matches - rulesOnlyLands),
    pulledIn: Math.max(0, lands - rulesOnlyLands),
  };
}
