import { useMemo, useState } from 'react';
import type { PublicDeck, PublicDeckCard } from '../../lib/shared-types';
import { deckBucketFor, DECK_BUCKET_ORDER, type DeckBucketKey } from '../../lib/shared-grouping';
import { SharedCardTile } from './SharedCardTile';
import { SharedCardModal } from './SharedCardModal';
import type { PublicCard } from '../../lib/shared-types';

interface Props {
  data: PublicDeck;
}

/**
 * Coerces a deck's stored `card: ScryfallCard`-shaped value into the PublicCard
 * shape used by the shared tile/modal components. Best-effort — fields not
 * present on the deck card (purchasePrice, condition, etc.) default to safe
 * placeholders.
 */
function deckCardToPublicCard(slot: PublicDeckCard): PublicCard {
  const c = slot.card;
  // Scryfall's card shape uses snake_case (image_uris, type_line, mana_cost).
  // EnrichedCards persisted on the owner's side use camelCase. The deck slot's
  // `card` is a ScryfallCard, so prefer snake_case fields with camelCase fallback.
  const img = (c.image_uris ?? {}) as { small?: string; normal?: string; large?: string };
  // Back-face fallback for transform/modal_dfc layouts is handled by Scryfall
  // via card_faces; deck slots usually carry the front-face image_uris already.
  return {
    name: String(c.name ?? '(unknown)'),
    scryfallId: typeof c.id === 'string' ? c.id : '',
    setCode: typeof c.set === 'string' ? c.set : '',
    setName: typeof c.set_name === 'string' ? c.set_name : '',
    collectorNumber: typeof c.collector_number === 'string' ? c.collector_number : '',
    rarity: typeof c.rarity === 'string' ? c.rarity : '',
    finish: 'nonfoil',
    foil: false,
    purchasePrice: 0,
    cmc: typeof c.cmc === 'number' ? c.cmc : undefined,
    typeLine: typeof c.type_line === 'string' ? c.type_line : undefined,
    colorIdentity: Array.isArray(c.color_identity) ? (c.color_identity as string[]) : undefined,
    colors: Array.isArray(c.colors) ? (c.colors as string[]) : undefined,
    imageSmall: img.small,
    imageNormal: img.normal ?? img.large,
    manaCost: typeof c.mana_cost === 'string' ? c.mana_cost : undefined,
  };
}

interface BucketedCard {
  publicCard: PublicCard;
  quantity: number;
}

export function SharedDeckView({ data }: Props) {
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState<PublicCard | null>(null);

  // Group identical card names within the mainboard (same physical printing
  // would be the same scryfallId; a decklist usually shows "Forest x4").
  const mainboard: Map<DeckBucketKey, BucketedCard[]> = useMemo(() => {
    const buckets = new Map<DeckBucketKey, Map<string, BucketedCard>>();
    for (const slot of data.cards) {
      const pc = deckCardToPublicCard(slot);
      const bucket = deckBucketFor(pc.typeLine);
      const existing = buckets.get(bucket) ?? new Map();
      const stackKey = `${pc.scryfallId}::${pc.name}`;
      const stack = existing.get(stackKey);
      if (stack) {
        stack.quantity += 1;
      } else {
        existing.set(stackKey, { publicCard: pc, quantity: 1 });
      }
      buckets.set(bucket, existing);
    }
    const out = new Map<DeckBucketKey, BucketedCard[]>();
    for (const [k, m] of buckets) out.set(k, Array.from(m.values()));
    return out;
  }, [data.cards]);

  const commanderCard = useMemo(
    () => (data.commander ? deckCardToPublicCard({ card: data.commander }) : null),
    [data.commander]
  );
  const partnerCard = useMemo(
    () => (data.partnerCommander ? deckCardToPublicCard({ card: data.partnerCommander }) : null),
    [data.partnerCommander]
  );

  const sideboardCards = useMemo(() => {
    if (data.sideboard.length === 0) return [];
    const stacks = new Map<string, BucketedCard>();
    for (const slot of data.sideboard) {
      const pc = deckCardToPublicCard(slot);
      const key = `${pc.scryfallId}::${pc.name}`;
      const stack = stacks.get(key);
      if (stack) stack.quantity += 1;
      else stacks.set(key, { publicCard: pc, quantity: 1 });
    }
    return Array.from(stacks.values());
  }, [data.sideboard]);

  const q = search.trim().toLowerCase();
  const matches = (pc: PublicCard) => (q ? pc.name.toLowerCase().includes(q) : true);

  const mainboardCount =
    data.cards.length + (data.commander ? 1 : 0) + (data.partnerCommander ? 1 : 0);

  return (
    <main className="shared-view">
      <header className="shared-view-header">
        <p className="shared-view-owner">Shared by @{data.ownerUsername}</p>
        <h1 className="shared-view-title">{data.name}</h1>
        <p className="shared-view-subtitle">
          {data.format} · {mainboardCount.toLocaleString()} cards
          {data.deckGrade ? ` · ${data.deckGrade.letter}` : ''}
        </p>
      </header>

      <div className="shared-toolbar">
        <input
          type="search"
          className="shared-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search cards in this deck…"
          aria-label="Search cards"
        />
      </div>

      {(commanderCard || partnerCard) && (
        <section className="shared-deck-section">
          <h2 className="shared-deck-section-heading">
            {partnerCard ? 'Commanders' : 'Commander'}
          </h2>
          <ul className="shared-card-grid shared-card-grid--small">
            {commanderCard && matches(commanderCard) && (
              <li>
                <SharedCardTile card={commanderCard} onClick={() => setPreview(commanderCard)} />
              </li>
            )}
            {partnerCard && matches(partnerCard) && (
              <li>
                <SharedCardTile card={partnerCard} onClick={() => setPreview(partnerCard)} />
              </li>
            )}
          </ul>
        </section>
      )}

      {DECK_BUCKET_ORDER.map((bucket) => {
        const cards = (mainboard.get(bucket) ?? []).filter((b) => matches(b.publicCard));
        if (cards.length === 0) return null;
        const count = cards.reduce((s, b) => s + b.quantity, 0);
        return (
          <section key={bucket} className="shared-deck-section">
            <h2 className="shared-deck-section-heading">
              {bucket} ({count})
            </h2>
            <ul className="shared-card-grid shared-card-grid--small">
              {cards.map((b, idx) => (
                <li key={idx}>
                  <SharedCardTile
                    card={b.publicCard}
                    quantity={b.quantity}
                    onClick={() => setPreview(b.publicCard)}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {sideboardCards.length > 0 && (
        <section className="shared-deck-section">
          <h2 className="shared-deck-section-heading">Sideboard ({data.sideboard.length})</h2>
          <ul className="shared-card-grid shared-card-grid--small">
            {sideboardCards
              .filter((b) => matches(b.publicCard))
              .map((b, idx) => (
                <li key={idx}>
                  <SharedCardTile
                    card={b.publicCard}
                    quantity={b.quantity}
                    onClick={() => setPreview(b.publicCard)}
                  />
                </li>
              ))}
          </ul>
        </section>
      )}

      {preview && <SharedCardModal card={preview} onClose={() => setPreview(null)} />}
    </main>
  );
}
