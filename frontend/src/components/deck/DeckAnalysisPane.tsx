import type { ScryfallCard } from '@/deck-builder/types';
import type { DeckManaData } from '@/lib/deck-analysis/deck-mana-types';
import type { AnalysisTabId } from '@/lib/deck-analysis/deck-view';
import { DeckAnalysisView } from './DeckAnalysisView';
import type { useDeckAnalysis } from './use-deck-analysis';
import type { DeckDisplayProps } from './deck-display-types';

type Derived = ReturnType<typeof useDeckAnalysis>;

interface Props {
  view: AnalysisTabId;
  /** The props DeckDisplay was given; the analysis views read the pass-through ones. */
  host: DeckDisplayProps;
  format: NonNullable<DeckDisplayProps['format']>;
  formatLabel: string;
  illegalCardNames: string[];
  allCards: ScryfallCard[];
  manaCards: readonly ScryfallCard[];
  manaData: DeckManaData;
  deckCardsByName: Derived['deckCardsByName'];
  shownRoles: Derived['shownRoles'];
  validation: Derived['validation'];
  identity: Derived['identity'];
}

/**
 * One analysis view (stats / power / tune / …) of the deck. Most of what it
 * shows is the host's own props passed straight through; the rest is what
 * DeckDisplay derived from the card list.
 */
export function DeckAnalysisPane({
  view,
  host,
  format,
  formatLabel,
  illegalCardNames,
  allCards,
  manaCards,
  manaData,
  deckCardsByName,
  shownRoles,
  validation,
  identity,
}: Props) {
  return (
    <DeckAnalysisView
      view={view}
      illegalCardNames={illegalCardNames}
      formatLabel={formatLabel}
      allCards={allCards}
      manaCards={manaCards}
      readOnly={host.readOnly ?? false}
      manaData={manaData}
      bracketEstimation={host.bracketEstimation}
      deckCardsByName={deckCardsByName}
      bracketOverride={host.bracketOverride}
      bracketMissesCombos={host.bracketMissesCombos}
      onSetBracketOverride={host.onSetBracketOverride}
      clockLibrary={host.clockLibrary}
      bracketTableSlot={host.bracketTableSlot}
      archetypeOverride={host.archetypeOverride}
      onSetArchetypeOverride={host.onSetArchetypeOverride}
      roleCounts={shownRoles.roleCounts}
      roleTargets={host.roleTargets}
      buildReport={host.buildReport}
      rampSubtypeCounts={shownRoles.rampSubtypeCounts}
      removalSubtypeCounts={shownRoles.removalSubtypeCounts}
      boardwipeSubtypeCounts={shownRoles.boardwipeSubtypeCounts}
      cardDrawSubtypeCounts={shownRoles.cardDrawSubtypeCounts}
      averageSalt={host.averageSalt}
      saltiestCards={host.saltiestCards}
      planScore={host.planScore}
      edhrecNumDecks={host.edhrecNumDecks}
      combosSlot={host.combosSlot}
      coachFeedSlot={host.coachFeedSlot}
      engineSlot={host.engineSlot}
      winConditionSlot={host.winConditionSlot}
      powerHeroSlot={host.powerHeroSlot}
      tableRecordSlot={host.tableRecordSlot}
      aiReviewSlot={host.aiReviewSlot}
      validation={validation}
      analysisState={host.analysisState ?? 'ready'}
      onNavigateToTune={host.onNavigateToTune}
      onRetryAnalysis={host.onRetryAnalysis}
      edhrecMissing={host.edhrecMissing}
      commander={host.commander}
      partnerCommander={host.partnerCommander}
      format={format}
      identity={identity}
      scoreRevealKey={host.scoreRevealKey}
      onAddSuggestedCard={host.onAddSuggestedCard}
      addingSuggestedCardNames={host.addingSuggestedCardNames}
      oneAwayCombos={host.oneAwayCombos}
      ownedOracleIds={host.ownedOracleIds}
      landUpgradeCount={host.landUpgradeCount}
    />
  );
}
