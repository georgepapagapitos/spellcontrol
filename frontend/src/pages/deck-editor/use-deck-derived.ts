import { useCallback, useMemo } from 'react';
import { type Deck } from '@/store/decks';
import { buildCommanderKey } from '@/lib/deck/commander-key';
import { analyzeDeckSynergy } from '@/deck-builder/services/synergy/deckSynergy';
import { toClockLibrary } from '@/lib/mana-sim/hand-classify';
import { speedPathOf } from '@/lib/mana-sim/speed-path';
import { getMaxCopies } from '@/lib/deck/deck-validation';
import type { ScryfallCard } from '@/deck-builder/types';
import { copyMismatches, missingSlots } from '@/lib/deck/deck-printing-actions';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import type { EnrichedCard } from '@spellcontrol/binder-routing';

export function useDeckDerived({
  deck,
  addZone,
  collectionById,
}: {
  deck: Deck;
  addZone: 'considering' | 'main' | 'side';
  collectionById: Map<string, EnrichedCard> | undefined;
}) {
  // Counts already in this deck — fed to the search panel so it can mark
  // duplicates with a live "in deck × N" hint and let users add basics
  // multiple times.
  const formatConfig = deck ? DECK_FORMAT_CONFIGS[deck.format] : null;

  // Commander decks are exactly 100 (mainboard 99, or 98 with a partner — the
  // partner is the 2nd commander). Other formats have no hard upper bound here,
  // so the replace-when-full prompt only fires for commander-like formats.
  const isCommander = !!formatConfig?.hasCommander;
  const mainboardLimit =
    isCommander && formatConfig
      ? formatConfig.mainboardSize - (deck?.partnerCommander ? 1 : 0)
      : Infinity;
  const deckIsFull = !!deck && deck.cards.length >= mainboardLimit;

  const existingCardCounts = useMemo(() => {
    const m = new Map<string, number>();
    if (!deck) return m;
    for (const c of deck.cards) m.set(c.card.name, (m.get(c.card.name) ?? 0) + 1);
    for (const c of deck.sideboard) m.set(c.card.name, (m.get(c.card.name) ?? 0) + 1);
    return m;
  }, [deck]);

  /**
   * Is this name already at its legal copy limit for the zone being added to?
   * The deck row's own menu gates "Add another copy" on the same question
   * (`DeckMainboardRow`: `disabled={atCap}`, "add affordances agree by
   * construction, not by convention") — the Add cards panel did not, so it
   * would happily put a 2nd Sol Ring in a Commander deck and the Stats tab
   * would then flag the Singleton failure the panel had just created.
   *
   * Considering is a staging area with no ceiling, exactly as the quantity
   * path already rules (see `maxCopies` in the qty handler below).
   */
  const atCopyLimit = useCallback(
    (name: string) => {
      if (!deck || addZone === 'considering') return false;
      const zone = addZone === 'side' ? deck.sideboard : deck.cards;
      const copies = zone.filter((c) => c.card.name === name);
      if (copies.length === 0) return false;
      return copies.length >= getMaxCopies(copies[0].card, !!formatConfig?.isSingleton);
    },
    [deck, addZone, formatConfig]
  );

  // Name → the actual deck printing. Feeds Optimize's Remove column so its card
  // preview shows the printing in the deck (matching the thumbnail) instead of
  // the default printing the carousel would otherwise fetch by name.
  // Oracle ids of every card in the deck — fed to the combos panel so it can
  // bucket combos against the deck. `oracle_id` is on ScryfallCard; cards
  // imported before that field landed may lack it (combos for those rows just
  // won't surface until the next deck-import).
  const deckOracleIds = useMemo(() => {
    if (!deck) return [];
    const ids = new Set<string>();
    if (deck.commander?.oracle_id) ids.add(deck.commander.oracle_id);
    if (deck.partnerCommander?.oracle_id) ids.add(deck.partnerCommander.oracle_id);
    for (const c of deck.cards) if (c.card.oracle_id) ids.add(c.card.oracle_id);
    for (const c of deck.sideboard) if (c.card.oracle_id) ids.add(c.card.oracle_id);
    return Array.from(ids);
  }, [deck]);

  // Commander(s) + mainboard only — the sideboard is a swap pile, not part of
  // the 99. Every bracket/coach/hero/badge signal reads combos against THIS
  // set (via `mainboardComboData` below), never the wider `deckOracleIds` the
  // combo match itself runs against — a combo completed only by a sideboard
  // card must never set a bracket floor (see combo-zone-partition.ts).
  const mainboardOracleIds = useMemo(() => {
    const ids = new Set<string>();
    if (!deck) return ids;
    if (deck.commander?.oracle_id) ids.add(deck.commander.oracle_id);
    if (deck.partnerCommander?.oracle_id) ids.add(deck.partnerCommander.oracle_id);
    for (const c of deck.cards) if (c.card.oracle_id) ids.add(c.card.oracle_id);
    return ids;
  }, [deck]);

  // Tokens this deck can make — a pre-game prep checklist surfaced on demand from
  // the deck-action row (not Stats; it's prep, not analysis). The hook re-resolves
  // names to recover token data the slimmed persisted cards drop.
  const deckScryCards = useMemo(() => {
    if (!deck) return [];
    const list: ScryfallCard[] = [];
    if (deck.commander) list.push(deck.commander);
    if (deck.partnerCommander) list.push(deck.partnerCommander);
    for (const c of deck.cards) list.push(c.card);
    return list;
  }, [deck]);
  const hasPullSlots =
    !!deck && (deck.cards.length > 0 || deck.sideboard.length > 0 || !!deck.commander);
  // The two printing rows in ⋮ Deck actions show only when they have slots to
  // act on: a missing card to reprice, or an owned slot off its copy's printing.
  const hasMissingSlots = useMemo(
    () => !!deck && missingSlots(deck, collectionById).length > 0,
    [deck, collectionById]
  );
  const hasCopyMismatches = useMemo(
    () => !!deck && copyMismatches(deck, collectionById).length > 0,
    [deck, collectionById]
  );

  // Flat card list for EnginePanel's tappable axis drill-through — mainboard only
  // (commanders don't form a typical synergy axis row).
  const deckCards = useMemo(() => (deck ? deck.cards.map((c) => c.card) : []), [deck]);
  // Library (one entry per physical copy) for WinConditionPanel's assembly
  // clock — it costs cards out, so it needs mana value + land/ramp, not names.
  const deckLibrary = useMemo(() => toClockLibrary(deckCards), [deckCards]);
  // The win path the Bracket panel's Speed read times (null: nothing to time).
  const speedPath = useMemo(() => speedPathOf(deck?.winConditions), [deck?.winConditions]);
  // Full axis summaries (card names + reasons) for the EnginePanel annotation layer.
  const axisSummaries = useMemo(
    () => (deck?.synergyAnalysis ? analyzeDeckSynergy(deckCards).axes : undefined),
    [deck?.synergyAnalysis, deckCards]
  );

  // Lowercased mainboard names — the CoachFeed's ground truth for hiding
  // applied suggestions (and resurfacing them when an apply is undone).
  const deckCardNames = useMemo(() => {
    const names = new Set<string>();
    for (const c of deck?.cards ?? []) names.add(c.card.name.toLowerCase());
    return names;
  }, [deck?.cards]);

  // The command zone's names, kept out of the add-cards result lists when the
  // add targets the mainboard (the panel gates this on `addZone`).
  const commanderName = deck?.commander?.name;
  const partnerCommanderName = deck?.partnerCommander?.name;
  const commanderNames = useMemo(() => {
    const names: string[] = [];
    if (commanderName) names.push(commanderName);
    if (partnerCommanderName) names.push(partnerCommanderName);
    return names;
  }, [commanderName, partnerCommanderName]);

  const commanderColorIdentity = useMemo(() => {
    if (!deck) return [];
    const ci = new Set<string>();
    for (const c of deck.commander?.color_identity ?? []) ci.add(c);
    for (const c of deck.partnerCommander?.color_identity ?? []) ci.add(c);
    return [...ci];
  }, [deck]);
  // Only commander decks carry an identity restriction — undefined disables
  // the hook's suggestion filter (an empty array would mean "colorless").
  const comboColorIdentity =
    deck?.commander || deck?.partnerCommander ? commanderColorIdentity : undefined;

  // Commander (+partner) key for CardSearchPanel's per-row "N on SpellControl"
  // badge (social W4) — undefined for a no-commander deck, so the panel's
  // fetch never fires.
  const commanderKey = deck?.commander?.oracle_id
    ? buildCommanderKey(deck.commander.oracle_id, deck.partnerCommander?.oracle_id)
    : undefined;

  return {
    deckScryCards,
    commanderColorIdentity,
    deckOracleIds,
    comboColorIdentity,
    mainboardOracleIds,
    formatConfig,
    mainboardLimit,
    deckCards,
    deckCardNames,
    deckIsFull,
    commanderNames,
    existingCardCounts,
    atCopyLimit,
    commanderKey,
    isCommander,
    hasPullSlots,
    deckLibrary,
    speedPath,
    hasCopyMismatches,
    hasMissingSlots,
    axisSummaries,
  };
}
