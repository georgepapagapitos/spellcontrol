import { pickDeckCover, type DeckCoverInput } from '@spellcontrol/deck-metrics';
import type { ScryfallCard } from '@/deck-builder/types';
import { scryfallArtCrop } from '@/lib/offline/slim-to-scryfall';

/**
 * Art crop URL for a deck's cover: the owner's pick, else the commander, else
 * the deck's signature card (`pickDeckCover`). Every deck surface reads this,
 * so a Pauper deck gets the same face on its tile as on its page.
 *
 * Offline-resolved cards carry only the `normal` scan, and some older rows
 * baked that full-card URL into `art_crop`; `scryfallArtCrop` swaps either to
 * a real crop and is a no-op on one.
 */
export function deckCoverArt(deck: DeckCoverInput<ScryfallCard>): string | undefined {
  return cardCoverArt(pickDeckCover(deck));
}

function cardCoverArt(card: ScryfallCard | null | undefined): string | undefined {
  if (!card) return undefined;
  const face = card.card_faces?.[0]?.image_uris;
  const raw =
    card.image_uris?.art_crop ?? face?.art_crop ?? card.image_uris?.normal ?? face?.normal;
  return raw ? scryfallArtCrop(raw) : undefined;
}
