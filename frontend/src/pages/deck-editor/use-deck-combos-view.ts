import { useCallback, useMemo } from 'react';
import { type Deck } from '@/store/decks';
import { type DeckCombosPanelHandle } from '@/components/deck/DeckCombosPanel';
import { useDeckCombos } from '@/lib/deck-analysis/use-deck-combos';
import {
  partitionCombosByZone,
  toMainboardComboData,
} from '@/lib/deck-analysis/combo-zone-partition';
import type { ComboMatch } from '@/types/combos';
import type { RefObject } from 'react';

export function useDeckCombosView({
  deckOracleIds,
  ownedOracleIds,
  deck,
  comboColorIdentity,
  mainboardOracleIds,
  ownedOracleIdSet,
  combosRef,
}: {
  deckOracleIds: string[];
  ownedOracleIds: string[];
  deck: Deck;
  comboColorIdentity: string[] | undefined;
  mainboardOracleIds: Set<string>;
  ownedOracleIdSet: Set<string>;
  combosRef: RefObject<DeckCombosPanelHandle | null>;
}) {
  const comboData = useDeckCombos({
    deckOracleIds,
    ownedOracleIds,
    format: deck?.format,
    colorIdentity: comboColorIdentity,
  });

  // Commander(s) + mainboard view of `comboData` — every analysis/coach/hero/
  // badge consumer below reads THIS, never the raw response, so a combo
  // completed only via a sideboard card never sets a bracket floor, never
  // counts toward a total, and is never offered as "one card away" (see
  // combo-zone-partition.ts). The Combos panel keeps the raw `comboData` for
  // its own list (still shows the sideboard-completed combo, marked).
  const partitionedCombos = useMemo(
    () => partitionCombosByZone(comboData.data, mainboardOracleIds),
    [comboData.data, mainboardOracleIds]
  );
  const mainboardComboData = useMemo(
    () => toMainboardComboData(comboData.data, partitionedCombos),
    [comboData.data, partitionedCombos]
  );

  // Mainboard-scoped combo data already buckets combos into in-deck / one-away
  // — reused here rather than a second match, keyed by oracle id so each deck
  // row's inline "CB"/"CB2" badge can look itself up in O(1) and never
  // disagree with the panel's mainboard-complete list.
  const combosByOracle = useMemo(() => {
    const map = new Map<string, ComboMatch[]>();
    const all = [...(mainboardComboData?.inDeck ?? []), ...(mainboardComboData?.oneAway ?? [])];
    for (const match of all) {
      for (const c of match.combo.cards) {
        const list = map.get(c.oracleId);
        if (list) list.push(match);
        else map.set(c.oracleId, [match]);
      }
    }
    return map;
  }, [mainboardComboData]);

  // Count one-away combos whose missing piece the user already owns.
  // Uses the `oneAway` bucket (not `almostInCollection`, which is empty for
  // decks with oracle IDs — see match.ts:112) filtered against the owned set.
  const comboOwnedMissingCount = useMemo(
    () =>
      (mainboardComboData?.oneAway ?? []).filter((m) => {
        const id = m.missingOracleIds[0];
        return id && ownedOracleIdSet.has(id);
      }).length,
    [mainboardComboData?.oneAway, ownedOracleIdSet]
  );

  // The Power hero's summary lines deep-link to their detail panels below.
  // Bracket and Engine are always-open panels, so a scroll suffices; Combos is
  // collapsible, so reuse its reveal() handle (expand + scroll + focus), landing
  // on the one-away tab when the user owns completable pieces or the deck has
  // no complete combo to show.
  const scrollToPowerPanel = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, []);
  const handleViewBracket = useCallback(
    () => scrollToPowerPanel('deck-power-bracket'),
    [scrollToPowerPanel]
  );
  const handleViewEngine = useCallback(
    () => scrollToPowerPanel('deck-power-engine'),
    [scrollToPowerPanel]
  );
  const handleViewWinConditions = useCallback(
    () => scrollToPowerPanel('deck-power-wincon'),
    [scrollToPowerPanel]
  );
  const comboInDeckCount = mainboardComboData?.inDeck.length ?? 0;
  const handleViewCombos = useCallback(() => {
    combosRef.current?.reveal(
      comboOwnedMissingCount > 0 || comboInDeckCount === 0 ? 'oneAway' : 'inDeck'
    );
  }, [combosRef, comboOwnedMissingCount, comboInDeckCount]);

  return {
    mainboardComboData,
    comboData,
    handleViewCombos,
    handleViewWinConditions,
    handleViewBracket,
    combosByOracle,
    comboOwnedMissingCount,
    handleViewEngine,
  };
}
