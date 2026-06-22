import { useMemo, useState } from 'react';
import { LayoutGrid, List as ListIcon } from 'lucide-react';
import type { PublicDeck, PublicDeckCard } from '../../lib/shared-types';
import {
  availableRarities,
  availableSets,
  availableTypes,
  deckBucketFor,
  DECK_BUCKET_ORDER,
  emptySharedFilters,
  matchesSharedFilters,
  type DeckBucketKey,
  type SharedFilters,
} from '../../lib/shared-grouping';
import { normalizeForSearch } from '../../lib/normalize-search';
import { SharedCardTile } from './SharedCardTile';
import { SharedCardList, type SharedCardListItem } from './SharedCardList';
import { SharedCardModal } from './SharedCardModal';
import { SharedFilterPopover } from './SharedFilterPopover';
import { SearchPill } from '../SearchPill';
import { ViewModeToggle } from '../ViewModeToggle';
import { CopyDeckButton } from './CopyDeckButton';
import type { PublicCard } from '../../lib/shared-types';

interface Props {
  data: PublicDeck;
}

type ViewKind = 'grid' | 'list';

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

/** Map a bucket's stacked cards into the shared list-row shape. */
function toListItems(cards: BucketedCard[]): SharedCardListItem[] {
  return cards.map((b, idx) => ({
    key: `${b.publicCard.scryfallId}-${b.publicCard.name}-${idx}`,
    card: b.publicCard,
    quantity: b.quantity,
  }));
}

export function SharedDeckView({ data }: Props) {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<SharedFilters>(emptySharedFilters);
  const [view, setView] = useState<ViewKind>('grid');
  const [preview, setPreview] = useState<PublicCard | null>(null);

  // Facet options derive from every card in the deck (mainboard + commanders
  // + sideboard), coerced to the PublicCard shape.
  const allCards = useMemo(() => {
    const cards = data.cards.map((slot) => deckCardToPublicCard(slot));
    if (data.commander) cards.push(deckCardToPublicCard({ card: data.commander }));
    if (data.partnerCommander) cards.push(deckCardToPublicCard({ card: data.partnerCommander }));
    for (const slot of data.sideboard) cards.push(deckCardToPublicCard(slot));
    return cards;
  }, [data.cards, data.commander, data.partnerCommander, data.sideboard]);
  const rarityOptions = useMemo(() => availableRarities(allCards), [allCards]);
  const typeOptions = useMemo(() => availableTypes(allCards), [allCards]);
  const setOptions = useMemo(() => availableSets(allCards), [allCards]);

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

  const q = normalizeForSearch(search);
  const matches = (pc: PublicCard) =>
    (q ? normalizeForSearch(pc.name).includes(q) : true) && matchesSharedFilters(pc, filters);

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
        <SearchPill
          value={search}
          onChange={setSearch}
          placeholder="Search cards in this deck…"
          ariaLabel="Search cards"
          className="shared-toolbar-search"
          trailing={
            <SharedFilterPopover
              filters={filters}
              setFilters={setFilters}
              rarities={rarityOptions}
              types={typeOptions}
              sets={setOptions}
              showValue={false}
            />
          }
        />
        <ViewModeToggle<ViewKind>
          ariaLabel="Deck view mode"
          value={view}
          onChange={setView}
          options={[
            {
              value: 'grid',
              label: 'Grid view',
              icon: <LayoutGrid width={14} height={14} strokeWidth={2} aria-hidden />,
            },
            {
              value: 'list',
              label: 'List view',
              icon: <ListIcon width={14} height={14} strokeWidth={2} aria-hidden />,
            },
          ]}
        />
      </div>

      {(commanderCard || partnerCard) && (
        <section className="shared-deck-section">
          <h2 className="shared-deck-section-heading">
            {partnerCard ? 'Commanders' : 'Commander'}
          </h2>
          {(() => {
            const commanders = [commanderCard, partnerCard].filter(
              (c): c is PublicCard => c != null && matches(c)
            );
            return view === 'grid' ? (
              <ul className="shared-card-grid shared-card-grid--small">
                {commanders.map((c, idx) => (
                  <li key={`${c.scryfallId}-${idx}`}>
                    <SharedCardTile card={c} onClick={() => setPreview(c)} />
                  </li>
                ))}
              </ul>
            ) : (
              <SharedCardList
                items={commanders.map((c, idx) => ({
                  key: `${c.scryfallId}-${idx}`,
                  card: c,
                  quantity: 1,
                }))}
                onPreview={setPreview}
                showPrice={false}
              />
            );
          })()}
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
            {view === 'grid' ? (
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
            ) : (
              <SharedCardList items={toListItems(cards)} onPreview={setPreview} showPrice={false} />
            )}
          </section>
        );
      })}

      {sideboardCards.length > 0 && (
        <section className="shared-deck-section">
          <h2 className="shared-deck-section-heading">Sideboard ({data.sideboard.length})</h2>
          {(() => {
            const visible = sideboardCards.filter((b) => matches(b.publicCard));
            return view === 'grid' ? (
              <ul className="shared-card-grid shared-card-grid--small">
                {visible.map((b, idx) => (
                  <li key={idx}>
                    <SharedCardTile
                      card={b.publicCard}
                      quantity={b.quantity}
                      onClick={() => setPreview(b.publicCard)}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <SharedCardList
                items={toListItems(visible)}
                onPreview={setPreview}
                showPrice={false}
              />
            );
          })()}
        </section>
      )}

      <CopyDeckButton data={data} variant="block" />

      {preview && <SharedCardModal card={preview} onClose={() => setPreview(null)} />}
    </main>
  );
}
