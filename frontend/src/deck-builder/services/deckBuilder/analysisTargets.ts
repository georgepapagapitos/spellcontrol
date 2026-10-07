/**
 * The targets the analysis grades a saved deck against.
 *
 * A generated deck was built to a plan (role targets, a land count, a pacing:
 * `deckGeneration/buildPlan.ts`). Its grade has to read the same plan, or the
 * deck is graded A when generation finishes and B when Coach opens it (E573).
 * A hand-built deck has no plan, so the analysis derives targets from the
 * commander and the deck as it stands.
 */
import type {
  Archetype,
  EDHRECCommanderData,
  Pacing,
  ScryfallCard,
  ThemeResult,
} from '@/deck-builder/types';
import type { Deck } from '@/store/decks';
import type { CommanderProfile } from './commanderProfile';
import { prefersOneSidedWipes, shaveWipeTarget } from './coachWipes';
import {
  resolveBuildPlan,
  wantsExtraCombat,
  type BuildPlanSettings,
} from './deckGeneration/buildPlan';
import { getDynamicRoleTargets } from './roleTargets';

/** How a generated deck was built, read off its saved generation context. */
export interface DeckBuild {
  settings: BuildPlanSettings;
  /** Every theme the player had picked, selected or not. */
  selectedThemes: ThemeResult[];
  /** The archetype generation built as (`buildReport.archetype`). */
  archetype?: Archetype;
}

/**
 * The build behind a generated deck, from its saved generation context and
 * build report. Undefined for a hand-built or imported deck (no context). A
 * deck saved before the settings were recorded reads the defaults, the same
 * ones a fresh build starts from.
 */
export function deckBuildOf(
  deck: Pick<Deck, 'generationContext'> & { buildReport?: { archetype?: Archetype } }
): DeckBuild | undefined {
  const gc = deck.generationContext;
  if (!gc) return undefined;
  const c = gc.customization ?? {};
  return {
    settings: {
      deckFormat: c.deckFormat ?? 99,
      landCount: c.landCount ?? gc.landCount,
      nonBasicLandCount: c.nonBasicLandCount ?? 15,
      tempoAutoDetect: c.tempoAutoDetect ?? true,
      tempoPacing: c.tempoPacing ?? 'balanced',
    },
    selectedThemes: gc.selectedThemes ?? [],
    archetype: deck.buildReport?.archetype,
  };
}

export interface AnalysisTargets {
  roleTargets: Record<string, number>;
  /** Grade against this pacing / land count instead of deriving them. Set for a generated deck. */
  overridePacing?: Pacing;
  overrideLandTarget?: number;
}

export function deriveAnalysisTargets(input: {
  commanders: readonly ScryfallCard[];
  cards: readonly ScryfallCard[];
  deckSize: number;
  edhrecData: EDHRECCommanderData;
  /** The theme pages the page was read from; a hand-built deck has none. */
  sourceThemes: ThemeResult[] | undefined;
  profile: CommanderProfile;
  build?: DeckBuild;
}): AnalysisTargets {
  const { commanders, edhrecData, profile, build } = input;
  if (build && build.settings.deckFormat === input.deckSize) {
    const plan = resolveBuildPlan({
      format: input.deckSize,
      customization: build.settings,
      selectedThemes: build.selectedThemes,
      edhrecData,
      archetypeFallback: build.archetype ?? profile.primaryArchetype,
      hasPartner: commanders.length > 1,
      commanderWantsExtraCombat: wantsExtraCombat(commanders, profile),
    });
    return {
      roleTargets: plan.roleTargets,
      overridePacing: plan.pacing,
      overrideLandTarget: plan.resolvedLandCount,
    };
  }
  // Manual/imported decks have no selected themes, so without a fallback
  // this always lands on GOODSTUFF — thread the commander's own mechanically
  // detected archetype (tribal/spellslinger/etc.) the same way generation does.
  const { targets } = getDynamicRoleTargets(
    input.deckSize,
    input.sourceThemes,
    edhrecData.stats,
    edhrecData,
    undefined,
    undefined,
    profile.primaryArchetype
  );
  return {
    roleTargets: shaveWipeTarget(targets, prefersOneSidedWipes(commanders, profile, input.cards)),
  };
}
