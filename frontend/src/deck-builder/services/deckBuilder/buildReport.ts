import {
  Archetype,
  type BuildReport,
  type Customization,
  type DeckCategory,
  type GeneratedDeck,
} from '@/deck-builder/types';
import { buildSynergyFingerprint, topMatchedTags } from './synergyFingerprint';
import { isRoleExcess } from './deckAnalyzer';
import { countProtectionPieces } from './commanderDeckAnalysis';

// Archetypes where a deck built with ZERO protection/free-interaction pieces
// is a real gap worth flagging — Voltron (one big threat that needs Lightning
// Greaves/Swiftfoot Boots/Heroic Intervention-class insurance) for v1. Not
// broadened beyond this without panel evidence (E87-new Slice A).
const PROTECTION_MOTIVATED_ARCHETYPES: Archetype[] = [Archetype.VOLTRON];

/**
 * Assemble the compact, persisted "build report" recording how a generated
 * deck measured up to its build intent — the "fill + flag" feature: we keep
 * building, but flag what we couldn't hit (target vs estimated bracket, which
 * EDHREC pool we fell back to, % owned, basics padded, role gaps).
 *
 * Pure and unit-testable: it reads only the (mostly optional) fields off the
 * in-memory GeneratedDeck plus the relevant customization knobs and a set of
 * owned card names. Nothing is fetched or mutated.
 */
export function assembleBuildReport(input: {
  generated: GeneratedDeck;
  customization: Customization;
  collectionNames: Set<string>;
  claimedConflicts?: number;
}): BuildReport {
  const { generated, customization, collectionNames, claimedConflicts } = input;

  const builtFromCollection = generated.builtFromCollection ?? customization.collectionMode;
  const collectionStrategy = customization.collectionStrategy;

  const report: BuildReport = {
    targetBracket: customization.targetBracket,
    // Core (2) is the baseline when no estimation ran — the estimator never
    // auto-assigns Exhibition (1). See bracketEstimator CORE_BASELINE.
    estimatedBracket: generated.bracketEstimation?.bracket ?? 2,
    dataSource: generated.dataSource ?? 'base',
    builtFromCollection,
  };

  // Alternative generators: record how the deck was built for the report header.
  const mode = generated.generationMode ?? customization.generationMode ?? 'edhrec';
  if (mode !== 'edhrec') {
    report.generationMode = mode;
    report.generationModeDetail = generated.generationModeDetail;
    if (generated.generationRelaxedNote) report.generationNote = generated.generationRelaxedNote;
  }

  // Staples <-> Brew dial disclosure — undefined at the 0.5 Balanced default.
  const brewLevel = customization.brewLevel ?? 0.5;
  if (brewLevel > 0.5) {
    report.brewDialNote =
      'Brew dial leaned toward deep cuts — theme-synergy and hidden-synergy fit were weighted over raw EDHREC play-rate.';
  } else if (brewLevel < 0.5) {
    report.brewDialNote =
      'Brew dial leaned toward staples — raw EDHREC play-rate was weighted over theme-synergy fit.';
  }

  // Archetype-aware land count auto-tune disclosure (undefined when the user
  // set land count explicitly, or the default 37 was already the right call).
  if (generated.landCountNote) report.landCountNote = generated.landCountNote;
  if (generated.mustIncludeSkippedNote)
    report.mustIncludeSkippedNote = generated.mustIncludeSkippedNote;
  if (generated.budgetNote) report.budgetNote = generated.budgetNote;
  if (generated.roleCapOverflowNote) report.roleCapOverflowNote = generated.roleCapOverflowNote;
  if (generated.priceSanityNote) report.priceSanityNote = generated.priceSanityNote;
  if (generated.bracketPriceDisclosureNote)
    report.bracketPriceDisclosureNote = generated.bracketPriceDisclosureNote;
  if (generated.wipeAsymmetryNote) report.wipeAsymmetryNote = generated.wipeAsymmetryNote;
  if (generated.qualifiedPayoffGateNote)
    report.qualifiedPayoffGateNote = generated.qualifiedPayoffGateNote;
  if (generated.comboAuditBracketBlockNote)
    report.comboAuditBracketBlockNote = generated.comboAuditBracketBlockNote;
  if (generated.landSqueezeTrimNote) report.landSqueezeTrimNote = generated.landSqueezeTrimNote;
  if (generated.bracketPoolFallbackNote)
    report.bracketPoolFallbackNote = generated.bracketPoolFallbackNote;
  if (generated.integrityNotes && generated.integrityNotes.length > 0)
    report.integrityNotes = generated.integrityNotes;
  if (generated.comboUpsideNotes && generated.comboUpsideNotes.length > 0)
    report.comboUpsideNotes = generated.comboUpsideNotes;
  if (generated.comboCompletionNotes && generated.comboCompletionNotes.length > 0)
    report.comboCompletionNotes = generated.comboCompletionNotes;
  if (generated.flagshipSeatings && generated.flagshipSeatings.length > 0)
    report.flagshipSeatings = generated.flagshipSeatings;

  // Strategy only meaningful when actually building from the collection.
  if (builtFromCollection) {
    report.collectionStrategy = collectionStrategy;

    // % of non-commander mainboard cards owned by the user.
    const mainboard = (Object.keys(generated.categories) as DeckCategory[]).flatMap(
      (cat) => generated.categories[cat]
    );
    if (mainboard.length > 0) {
      const owned = mainboard.filter((card) => collectionNames.has(card.name)).length;
      report.ownedPercentActual = Math.round((owned / mainboard.length) * 100);
    } else {
      report.ownedPercentActual = 0;
    }

    // Requested owned-% target only applies in partial mode.
    if (collectionStrategy === 'partial') {
      report.ownedPercentTarget = customization.collectionOwnedPercent;
    }
  }

  // Basic lands added as last-resort filler (collection + filter shortfall).
  const basicsPadded = (generated.collectionShortfall ?? 0) + (generated.filterShortfall ?? 0);
  if (basicsPadded > 0) {
    report.basicsPadded = basicsPadded;
  }

  // Cards pulled from outside the collection to complete an owned-only build.
  if (generated.collectionRelaxedCount && generated.collectionRelaxedCount > 0) {
    report.collectionRelaxed = generated.collectionRelaxedCount;
  }

  // Owned cards substituted in for unowned staples ("Wanted X → used your Y").
  if (generated.collectionSubstitutions && generated.collectionSubstitutions.length > 0) {
    report.collectionSubstitutions = generated.collectionSubstitutions;
  }

  // Provenance for the deck's off-EDHREC cards — the ones the fallback fill added
  // because the owned∩EDHREC pool ran short (this is where the "0% inclusion"
  // cards come from). For each we surface the deck-synergy tags it shares with
  // the rest of the deck, so the user can see WHY it was picked (or that it was a
  // pure slot-filler with no shared tags). Collection builds only; needs the
  // inclusion map to tell EDHREC-sourced cards from fills.
  if (builtFromCollection && generated.cardInclusionMap) {
    const inclusionMap = generated.cardInclusionMap;
    const substituted = new Set((generated.collectionSubstitutions ?? []).map((s) => s.usedName));
    const nonLand = (Object.keys(generated.categories) as DeckCategory[])
      .filter((cat) => cat !== 'lands')
      .flatMap((cat) => generated.categories[cat]);
    const fingerprint = buildSynergyFingerprint(nonLand.map((c) => c.name));
    const liftedByMap = generated.liftedByMap;
    const synergyFills: Array<{ name: string; matchedTags: string[]; liftedBy?: string[] }> = [];
    for (const card of nonLand) {
      if (card.isMustInclude) continue; // a user-forced pick, not a fill
      if (card.isThemeSynergyCard) continue; // came from EDHREC's synergy lists
      if (substituted.has(card.name)) continue; // already shown as a substitution
      if ((inclusionMap[card.name] ?? 0) > 0) continue; // has an EDHREC signal
      synergyFills.push({
        name: card.name,
        matchedTags: topMatchedTags(card.name, fingerprint),
        liftedBy: liftedByMap?.[card.name.toLowerCase()],
      });
    }
    if (synergyFills.length > 0) report.synergyFills = synergyFills;
  }

  // Per-role "wanted N, got M" gaps where the deck fell short of target — and
  // the symmetric case, a role significantly crowding out the rest of the deck
  // (>1.5x target and >4 cards over; e.g. a ramp bucket at 24 vs an 11 target
  // eating the spell-density budget). Report only — nothing here auto-cuts.
  const roleTargets = generated.roleTargets;
  const roleExcesses: Array<{ role: string; have: number; want: number }> = [];
  if (roleTargets) {
    const roleCounts = generated.roleCounts ?? {};
    const roleGaps: Array<{ role: string; have: number; want: number }> = [];
    for (const [role, want] of Object.entries(roleTargets)) {
      const have = roleCounts[role] ?? 0;
      if (have < want) {
        roleGaps.push({ role, have, want });
      } else if (isRoleExcess(have, want)) {
        roleExcesses.push({ role, have, want });
      }
    }
    if (roleGaps.length > 0) {
      report.roleGaps = roleGaps;
    }
    if (roleExcesses.length > 0) {
      report.roleExcesses = roleExcesses;
    }
  }

  // buildRoleCapOverflowNote (deckGenerator.ts) always appends a "see
  // Overbuilt roles below" cross-reference — true only when roleExcesses
  // (Overbuilt roles) actually rendered. A role-surplus rebalance pass (E87)
  // can shrink every surplus below isRoleExcess's 1.3x threshold while still
  // tripping this pass's own (lower) over-cap bar, leaving roleExcesses empty
  // and the note pointing at a section that no longer exists. Strip the
  // dangling clause rather than change the threshold (out of scope).
  if (report.roleCapOverflowNote && roleExcesses.length === 0) {
    report.roleCapOverflowNote = report.roleCapOverflowNote.replace(
      / — see Overbuilt roles below for the full total\.$/,
      '.'
    );
  }

  // Protection/free-interaction piece count (E87-new Slice A) — always
  // rendered, including 0: the motivating gap is decks (esp. Voltron) that
  // silently generate none of these. Never role-tracked (parallel class, not
  // a RoleKey), so computed independently of roleTargets/roleCounts.
  const nonLandCards = (Object.keys(generated.categories) as DeckCategory[])
    .filter((cat) => cat !== 'lands')
    .flatMap((cat) => generated.categories[cat]);
  report.protectionCount = countProtectionPieces(nonLandCards);
  if (
    report.protectionCount === 0 &&
    generated.detectedArchetype != null &&
    PROTECTION_MOTIVATED_ARCHETYPES.includes(generated.detectedArchetype)
  ) {
    report.protectionZeroNote =
      'No protection or free-interaction pieces (e.g. Heroic Intervention, Swiftfoot Boots, Fierce Guardianship) — a Voltron deck usually wants insurance for its one big threat.';
  }

  // Coaching: cards that are owned but all copies are committed to other decks.
  if (claimedConflicts != null && claimedConflicts > 0) {
    report.claimedConflicts = claimedConflicts;
  }

  // Manabase self-explanation: sources built vs castability-weighted targets.
  if (generated.manabase && generated.manabase.lines.length > 0) {
    report.manabase = generated.manabase;
  }

  // Generation-end coherence audit: cards the final deck may not support.
  if (generated.coherenceFindings && generated.coherenceFindings.length > 0) {
    report.coherenceFindings = generated.coherenceFindings;
  }

  // Coherence repairs: swaps the bounded repair pass applied (nothing moves silently).
  if (generated.coherenceRepairs && generated.coherenceRepairs.length > 0) {
    report.coherenceRepairs = generated.coherenceRepairs;
  }

  // Budget-convergence swaps (E79): same "nothing moves silently" ethos.
  if (generated.budgetRepairs && generated.budgetRepairs.length > 0) {
    report.budgetRepairs = generated.budgetRepairs;
  }

  // Role-surplus → payoff conversions (E87): same "nothing moves silently" ethos.
  if (generated.surplusConversions && generated.surplusConversions.length > 0) {
    report.surplusConversions = generated.surplusConversions;
  }

  // "Hidden synergy" package picks — generation-time EDHREC lift suggestions.
  // Unconditional on builtFromCollection: unlike synergyFills these aren't
  // owned-build provenance, they're a suggestion regardless of build mode.
  if (generated.packagePicks && generated.packagePicks.length > 0) {
    report.packagePicks = generated.packagePicks;
    report.liftPicksNote = generated.liftPicksNote;
  }

  return report;
}
