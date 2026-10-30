import { useCallback, useMemo } from 'react';
import { deckCoverArt } from '@/lib/deck/deck-cover';
import { pickDeckCover } from '@spellcontrol/deck-metrics';
import { useDecksStore, type Deck } from '@/store/decks';
import { ownDeckValue } from '@/lib/deck/deck-value';
import { useProxyCopyIds } from '@/lib/deck/use-proxy-copy-ids';
import { useDeckPrices } from '@/components/deck/use-deck-prices';
import { useCurrency } from '@/lib/collection/currency';
import { useToastsStore } from '@/store/toasts';
import type { ScryfallCard } from '@/deck-builder/types';

export function useDeckHeroData({ deck, deckCards }: { deck: Deck; deckCards: ScryfallCard[] }) {
  const currency = useCurrency();
  const updateDeck = useDecksStore((s) => s.updateDeck);
  const pushToast = useToastsStore((s) => s.push);

  // Hero totals — a quick at-a-glance summary above the deck composition.
  // The count/value reflect the *mainboard deck only* (commanders + main
  // cards), matching the legality banner's notion of the deck; the sideboard
  // is surfaced separately (as "+N sideboard", distinct from the "+N
  // considering" maybe-pile right next to it — E183) so the hero doesn't
  // claim "104 cards" on a 100-card deck.
  const pricesVersion = useDeckPrices([deck?.commander, deck?.partnerCommander, ...deckCards]);
  // The value leaves proxies out (lib/deck/deck-value ownDeckValue); `proxied`
  // is what they would add, so the hero can say what it left out.
  const proxyCopyIds = useProxyCopyIds();
  const heroTotals = useMemo(() => {
    if (!deck) return { count: 0, value: 0, proxied: 0, sideboard: 0, considering: 0, extras: 0 };
    const { value, proxied } = (void pricesVersion, ownDeckValue(deck, proxyCopyIds, currency));
    return {
      count: (deck.commander ? 1 : 0) + (deck.partnerCommander ? 1 : 0) + deck.cards.length,
      value,
      proxied,
      sideboard: deck.sideboard.length,
      considering: (deck.considering ?? []).length,
      extras: (deck.extras ?? []).length,
    };
  }, [deck, currency, pricesVersion, proxyCopyIds]);

  // The deck's cover behind the hero, the same face its index tile wears
  // (lib/deck/deck-cover). Undefined only for a deck with no art at all; the hero
  // then keeps its plain color-border look.
  const heroArt = useMemo(() => (deck ? deckCoverArt(deck) : undefined), [deck]);
  // The card menu's "Use as deck cover". `chosen` is only the pick while that
  // card is still in the deck; after it leaves, the deck is back on automatic
  // and the menu should say so.
  const deckId = deck?.id;
  const coverCardName = deck?.coverCardName ?? null;
  const setCover = useCallback(
    (name: string | null) => {
      if (!deckId) return;
      updateDeck(deckId, { coverCardName: name });
      pushToast({
        message: name ? `${name} is now this deck's cover.` : 'The deck picks its own cover again.',
        tone: 'success',
      });
    },
    [deckId, updateDeck, pushToast]
  );
  const cover = useMemo(() => {
    if (!deck) return undefined;
    const current = pickDeckCover(deck)?.name ?? null;
    return { chosen: coverCardName === current ? coverCardName : null, current, set: setCover };
  }, [deck, coverCardName, setCover]);

  return { heroArt, heroTotals, cover };
}
