import { useCallback, useMemo } from 'react';
import type { PlaytestState } from '@/lib/playtest';
import { useDeckTokens } from '@/components/deck/use-deck-tokens';
import { useDecksStore } from '@/store/decks';
import { usePlaytestStore } from '../../store';
import { taxCommanders } from '../../lib/zones';
import type { MadeToken } from '../menu-entries';
import { buildCardLookup } from './board-derive';

/**
 * The deck behind this session and everything the board derives from it: the
 * card lookup for previews, the commanders the tax coins track, the sources
 * the token picker and the card menus read tokens from.
 */
export function useBoardDeck(state: PlaytestState, playtestDeckId: string | null | undefined) {
  // A shared or public deck is NOT in the viewer's decks store — it is
  // adapted per page and handed to the session, which parks it on the
  // playtest store as `externalDeck`. Looking only in the decks store is how
  // the board silently lost the deck on every `/d/:slug/playtest` and
  // `/s/:token/playtest` visit: the hand's card previews and the token
  // picker's "Deck tokens" grid both went empty with no error to show for
  // it. External wins, because when it exists it IS the deck being played.
  const externalDeck = usePlaytestStore((s) => s.externalDeck);
  const ownDeck = useDecksStore((s) =>
    playtestDeckId ? s.decks.find((d) => d.id === playtestDeckId) : undefined
  );
  const deck = externalDeck ?? ownDeck;

  // Build a map from each PlaytestCard instance id back to the underlying
  // ScryfallCard, so the OpeningHandSheet can pass full card data to the
  // shared CardPreview component without changing reducer types. The keys
  // mirror what `deckToPlaytestInit` produces (slotId#copy for mainboard,
  // cmd-<scryfallId> for commanders, sb-<slotId> for the sideboard).
  // The commanders the coins above the command zone track, gold then silver
  // in the deck's own order (see `taxCommanders`).
  const taxCards = useMemo(
    () =>
      taxCommanders(
        state,
        [deck?.commander?.id, deck?.partnerCommander?.id].flatMap((id) => (id ? [`cmd-${id}`] : []))
      ),
    [state, deck?.commander?.id, deck?.partnerCommander?.id]
  );

  const cardLookup = useMemo(() => buildCardLookup(deck), [deck]);

  // Fed to `findBannedCards` by the horde setup sheet — this deck's own
  // ban-list warnings (E387 PR 5).
  const hordeDeckCardNames = useMemo(() => deck?.cards.map((c) => c.card.name) ?? [], [deck]);

  // Every card of the deck behind this session, for the token picker's
  // "Deck tokens" grid. Commanders included — a commander is as likely to
  // be the thing making tokens as anything in the ninety-nine. The sideboard
  // too, so a card fetched into the game has its Create token row.
  const deckTokenSources = useMemo(() => {
    if (!deck) return [];
    const out = deck.cards.map((slot) => slot.card);
    if (deck.commander) out.push(deck.commander);
    if (deck.partnerCommander) out.push(deck.partnerCommander);
    for (const slot of deck.sideboard ?? []) out.push(slot.card);
    return out;
  }, [deck]);
  // Which tokens each card makes, for the card menus' Create token submenu —
  // the same Scryfall relationships the token picker's "Deck tokens" grid
  // reads, resolved once for the deck.
  const deckTokens = useDeckTokens(deckTokenSources);
  const tokensMadeBy = useCallback(
    (name: string): MadeToken[] =>
      deckTokens
        .filter((t) => t.producers.includes(name))
        .map((t) => (t.typeLine ? { name: t.name, typeLine: t.typeLine } : { name: t.name })),
    [deckTokens]
  );

  return { deck, taxCards, cardLookup, hordeDeckCardNames, deckTokenSources, tokensMadeBy };
}
