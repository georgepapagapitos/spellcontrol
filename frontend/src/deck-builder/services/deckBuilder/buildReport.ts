import type { BuildReport, Customization, DeckCategory, GeneratedDeck } from '@/deck-builder/types';

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
    estimatedBracket: generated.bracketEstimation?.bracket ?? 1,
    dataSource: generated.dataSource ?? 'base',
    builtFromCollection,
  };

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

  // Per-role "wanted N, got M" gaps where the deck fell short of target.
  const roleTargets = generated.roleTargets;
  if (roleTargets) {
    const roleCounts = generated.roleCounts ?? {};
    const roleGaps: Array<{ role: string; have: number; want: number }> = [];
    for (const [role, want] of Object.entries(roleTargets)) {
      const have = roleCounts[role] ?? 0;
      if (have < want) {
        roleGaps.push({ role, have, want });
      }
    }
    if (roleGaps.length > 0) {
      report.roleGaps = roleGaps;
    }
  }

  // Coaching: cards that are owned but all copies are committed to other decks.
  if (claimedConflicts != null && claimedConflicts > 0) {
    report.claimedConflicts = claimedConflicts;
  }

  return report;
}
