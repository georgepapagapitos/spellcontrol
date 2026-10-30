import { type Deck } from '@/store/decks';
import { collectGroupNames } from '@/lib/deck/deck-tags';
import { CardSearchPanel, type CardSearchPanelHandle } from '@/components/deck/CardSearchPanel';
import { BuildTimeCoachStrip } from '@/components/deck/BuildTimeCoachStrip';
import { DeckAiRefine } from '@/components/deck/DeckAiRefine';
import { fromGapCard, toSwapAgainst, sortOwnedFirst, type Change } from '@/lib/coach/deck-change';
import { buildSwapAlternativeFactors } from '@/lib/coach/why-factors';
import { SwapThisCard } from '@/components/deck/SwapThisCard';
import { SimilarCardsStrip } from '@/components/deck/SimilarCardsStrip';
import * as substitutesV2 from '@/deck-builder/services/substitutes/surfaces';
import { classifyCandidate } from '@/lib/deck-analysis/deck-analysis';
import type { ScryfallCard } from '@/deck-builder/types';
import { AddZoneToggle } from './AddZoneToggle';
import type { AddZone } from './add-zone';
import type { Dispatch, SetStateAction, RefObject } from 'react';
import type { DeckFormatConfig } from '@/deck-builder/types';
import type { BuildTimeNudge } from '@/lib/coach/use-build-time-nudge';
import type { AnalysisTabId } from '@/lib/deck-analysis/deck-view';
import type { BinderInfo } from '@/lib/binder/binder-refs';
import type { ComboMatchResponse } from '@/types/combos';
import type { ChangeOwnership } from '@/lib/coach/deck-change';
import type { RefineCard } from '@/lib/ai/ai-refine';
import type { AiScope } from '@/lib/ai/ai-scope';
import type { EnrichedCard } from '@spellcontrol/binder-routing';

export function useDeckCardRenderers({
  addZone,
  setAddZone,
  formatConfig,
  buildTimeNudge,
  openAnalysisTab,
  handleViewCombos,
  handleViewWinConditions,
  handleViewBracket,
  searchPanelRef,
  deck,
  commanderColorIdentity,
  commanderNames,
  existingCardCounts,
  atCopyLimit,
  binderByCardName,
  addChosenCard,
  setAuditionCard,
  mainboardComboData,
  ownershipFor,
  analysisState,
  bracketAnalysis,
  commanderKey,
  refinePool,
  aiScope,
  refineAlternatives,
  deckIsFull,
  setShowAddPanel,
  handleApplyCoachMove,
  handleApplyCostSwaps,
  swappingSlot,
  handleSwapInDeck,
  collectionCards,
  freeCountFor,
}: {
  addZone: AddZone;
  setAddZone: Dispatch<SetStateAction<AddZone>>;
  formatConfig: DeckFormatConfig | null;
  buildTimeNudge: {
    nudge: BuildTimeNudge | null;
    notifyMainboardAdd: (cardName: string) => void;
    dismiss: () => void;
  };
  openAnalysisTab: (tab: AnalysisTabId) => void;
  handleViewCombos: () => void;
  handleViewWinConditions: () => void;
  handleViewBracket: () => void;
  searchPanelRef: RefObject<CardSearchPanelHandle | null>;
  deck: Deck;
  commanderColorIdentity: string[];
  commanderNames: string[];
  existingCardCounts: Map<string, number>;
  atCopyLimit: (name: string) => boolean;
  binderByCardName: Map<string, BinderInfo[]>;
  addChosenCard: (
    card: ScryfallCard,
    notify: boolean,
    full?: boolean,
    group?: string | null
  ) => 'added' | 'full';
  setAuditionCard: Dispatch<SetStateAction<ScryfallCard | null>>;
  mainboardComboData: ComboMatchResponse | null;
  ownershipFor: (name: string) => ChangeOwnership;
  analysisState: 'error' | 'pending' | 'ready';
  bracketAnalysis: {
    status: 'pending' | 'ready' | 'error';
    retry: () => void;
    missesCombos: boolean;
    edhrecMissing: boolean;
  };
  commanderKey: string | undefined;
  refinePool: RefineCard[];
  aiScope: AiScope;
  refineAlternatives: Map<string, string[]>;
  deckIsFull: boolean;
  setShowAddPanel: Dispatch<SetStateAction<boolean>>;
  handleApplyCoachMove: (change: Change) => Promise<void>;
  handleApplyCostSwaps: (
    swaps: Array<{ removeName: string; addName: string }>,
    kind?: 'budget' | 'bracket' | 'ai'
  ) => Promise<void>;
  swappingSlot: string | null;
  handleSwapInDeck: (
    slotId: string,
    oldName: string,
    newName: string,
    close: () => void
  ) => Promise<void>;
  collectionCards: EnrichedCard[];
  freeCountFor: (name: string) => number;
}) {
  // The add-cards panel's contents (zone toggle + coach strip + search),
  // hosted by the card-picker sheet (bottom sheet on mobile, centered
  // modal ≥1024px). `close` is the sheet's animated `dismiss`.
  const renderAddPanelContent = (close: () => void) => (
    <>
      <div className="card-picker-handle" aria-hidden />
      <AddZoneToggle addZone={addZone} setAddZone={setAddZone} formatConfig={formatConfig} />
      {/* Build-time coach nudge (E169 Half B) — strictly mainboard-only:
          an add to sideboard/considering doesn't touch the mainboard
          signature the combo/bracket/win-condition engines analyze, so
          it can never produce a nudge, and switching zone tabs away
          from Mainboard hides any nudge already showing. */}
      {addZone === 'main' && (
        <BuildTimeCoachStrip
          nudge={buildTimeNudge.nudge}
          onView={(kind) => {
            // A navigating strip (STYLE_GUIDE "Build-time coach
            // strip"), unlike the tap-opens-sheet insight strips: the
            // detail lives one tab over in the Power bento, not in a
            // local sheet, so leaving the add flow is unavoidable —
            // make it a deliberate close (dismiss the sheet) rather
            // than an accidental one.
            buildTimeNudge.dismiss();
            close();
            openAnalysisTab('power');
            window.requestAnimationFrame(() => {
              if (kind === 'combo') handleViewCombos();
              else if (kind === 'wincon') handleViewWinConditions();
              else handleViewBracket();
            });
          }}
          onDismiss={buildTimeNudge.dismiss}
        />
      )}
      <CardSearchPanel
        ref={searchPanelRef}
        deckId={deck.id}
        commanderColorIdentity={commanderColorIdentity}
        commanderNames={commanderNames}
        addZone={addZone}
        existingCardCounts={existingCardCounts}
        atCopyLimit={atCopyLimit}
        binderByCardName={binderByCardName}
        groupNames={collectGroupNames(deck)}
        onAdd={({ card, group }) => addChosenCard(card, false, undefined, group ?? null)}
        onPreviewFit={(card) => setAuditionCard(card)}
        onClose={close}
        suggestions={deck.gapAnalysis}
        oneAwayCombos={mainboardComboData?.oneAway}
        hiddenGems={deck.hiddenGems}
        ownershipFor={ownershipFor}
        // Suggestions are read against a commander, so they wait for one; the
        // format's own rules (legality, and identity once there is one) don't.
        enableSuggestions={!!formatConfig?.hasCommander && !!deck.commander}
        noCommanderYet={!!formatConfig?.hasCommander && !deck.commander}
        legalityKey={formatConfig?.legalityKey}
        suggestionsPending={analysisState === 'pending'}
        suggestionsFailed={analysisState === 'error'}
        onRetrySuggestions={analysisState === 'error' ? bracketAnalysis.retry : undefined}
        commanderKey={commanderKey}
        aiSlot={
          formatConfig?.hasCommander && deck.commander ? (
            /* `key={deck.id}` on EVERY mount of this panel is load-bearing, not
               cosmetic: `/decks/:id` has no route key, so react-router reuses
               this page element when navigating between decks and the panel
               would otherwise never unmount — leaving the previous deck's
               reading on screen (its "Apply all" would push those swaps into the
               deck now open) and its dismissal set in state, which the next save
               would write back under this deck's key. */
            <DeckAiRefine
              key={deck.id}
              variant="suggestions"
              deckId={deck.id}
              format={deck.format}
              commander={deck.commander}
              partnerCommander={deck.partnerCommander ?? null}
              mainboard={deck.cards.map((c) => ({ slotId: c.slotId, card: c.card }))}
              pool={refinePool}
              scope={aiScope}
              alternatives={refineAlternatives}
              bracketTarget={deck.bracketOverride ?? null}
              bracketEstimate={deck.bracketEstimation?.bracket ?? null}
              onApplyMove={(change) => {
                // Mirror the panel's own onAdd: a pure add on a full deck
                // opens the replace-when-full prompt, so the sheet gets
                // out of its way first (swaps stay in place).
                if (change.type === 'add' && deckIsFull) {
                  setShowAddPanel(false);
                }
                void handleApplyCoachMove(change);
              }}
              onApplyAll={(swaps) => handleApplyCostSwaps(swaps, 'ai')}
            />
          ) : undefined
        }
      />
    </>
  );

  // The in-context "Swap this card" alternatives for an in-deck card: role-scoped
  // EDHREC alternatives (same functional role, not the card itself), owned-first,
  // capped. Empty when the role is untagged or nothing fits.
  const swapAlternativesFor = (card: ScryfallCard) => {
    if (!deck) return [];
    const role = classifyCandidate(card.name);
    if (!role) return [];
    // Never re-propose a card already in the deck (addCard doesn't dedup, so it
    // would duplicate a slot) — guards the gapAnalysis recompute/offline window.
    const deckCardNames = new Set(deck.cards.map((c) => c.card.name));
    const gaps = (deck.gapAnalysis ?? []).filter(
      (g) => g.role === role && g.name !== card.name && !deckCardNames.has(g.name)
    );
    if (gaps.length === 0) return [];
    // Each alternative is a real swap (this card → the alternative), so the row
    // shows the trade: the focused card dimmed on the left, the alternative
    // coming in. The apply path still reads the incoming name (`onSwap`).
    const built = gaps.map((g) => {
      const ownership = ownershipFor(g.name);
      return {
        ...toSwapAgainst(fromGapCard(g, ownership), card.name),
        // Each same-role alternative gets its own grounded "why this over the
        // others" — replaces the six identical "{role} staple" reason lines.
        whyFactors: buildSwapAlternativeFactors({
          inclusion: g.inclusion,
          synergy: g.synergy,
          owned: ownership === 'owned',
          roleLabel: g.roleLabel,
          commanderName: deck.commander?.name,
        }),
      };
    });
    // E517: owned first, then by how well each replaces this card (v2), else by play rate.
    return (
      substitutesV2.rankSwapAlternatives(card.name, role, built, [...deckCardNames]) ??
      sortOwnedFirst(built)
    ).slice(0, 6);
  };

  const renderSwapSuggestions = (card: ScryfallCard, slotId: string, close: () => void) => {
    const alternatives = swapAlternativesFor(card);
    if (!deck || alternatives.length === 0) return null;
    return (
      <SwapThisCard
        currentName={card.name}
        alternatives={alternatives}
        swapping={swappingSlot === slotId}
        commanderName={deck.commander?.name}
        onSwap={(name) => void handleSwapInDeck(slotId, card.name, name, close)}
      />
    );
  };

  // In-context "Similar cards" for an in-deck card: owned look-alikes from the
  // collection, then broader synergy-axis discovery (see <SimilarCardsStrip>).
  // Same `(card, slotId, close)` shape + swap mechanics as renderSwapSuggestions.
  const renderSimilarCards = (card: ScryfallCard, slotId: string, close: () => void) => {
    if (!deck) return null;
    return (
      <SimilarCardsStrip
        target={card}
        deckCardNames={deck.cards.map((c) => c.card.name)}
        excludeNames={swapAlternativesFor(card).map((c) => c.name)}
        collectionCards={collectionCards}
        ownershipFor={ownershipFor}
        freeCountFor={freeCountFor}
        identity={commanderColorIdentity}
        inclusionMap={deck.cardInclusionMap ?? {}}
        onSwap={(name) => void handleSwapInDeck(slotId, card.name, name, close)}
        swapping={swappingSlot === slotId}
        commanderName={deck.commander?.name}
        enabled
      />
    );
  };

  return { renderSwapSuggestions, renderSimilarCards, renderAddPanelContent };
}
