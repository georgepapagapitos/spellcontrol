import { useMemo, useState } from 'react';
import { LayoutGrid, List as ListIcon } from 'lucide-react';
import type { PublicDeck, PublicDeckCard } from '../../lib/shared-types';
import { deckBucketFor, DECK_BUCKET_ORDER, type DeckBucketKey } from '../../lib/shared-grouping';
import { normalizeForSearch } from '../../lib/normalize-search';
import { SharedCardTile } from './SharedCardTile';
import { SharedCardList } from './SharedCardList';
import { CardPreview } from '../CardPreview';
import { publicCardToEnriched } from '../../lib/shared-filter';
import { useSharedFilters } from './use-shared-filters';
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
export function deckCardToPublicCard(slot: PublicDeckCard): PublicCard {
  const c = slot.card;
  // Scryfall's card shape uses snake_case (image_uris, type_line, mana_cost).
  // EnrichedCards persisted on the owner's side use camelCase. The deck slot's
  // `card` is a ScryfallCard, so prefer snake_case fields with camelCase fallback.
  // Front-face fallback for transform/modal_dfc layouts, whose top-level
  // image_uris can be absent (the faces carry them instead).
  const img = (c.image_uris ?? c.card_faces?.[0]?.image_uris ?? {}) as {
    small?: string;
    normal?: string;
    large?: string;
  };
  return {
    name: String(c.name ?? '(unknown)'),
    scryfallId: typeof c.id === 'string' ? c.id : '',
    oracleId: typeof c.oracle_id === 'string' ? c.oracle_id : undefined,
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
    oracleText: typeof c.oracle_text === 'string' ? c.oracle_text : undefined,
    legalities:
      c.legalities && typeof c.legalities === 'object'
        ? (c.legalities as Record<string, string>)
        : undefined,
    frameEffects: Array.isArray(c.frame_effects) ? (c.frame_effects as string[]) : undefined,
    fullArt: typeof c.full_art === 'boolean' ? c.full_art : undefined,
    borderColor: typeof c.border_color === 'string' ? c.border_color : undefined,
  };
}

interface BucketedCard {
  publicCard: PublicCard;
  quantity: number;
}

/** One rendered deck section (commander / type bucket / sideboard) with its
 *  start offset into the flat carousel list. */
interface DeckSection {
  key: string;
  /** Section heading, incl. count where the original layout showed one. */
  heading: string;
  /** Label surfaced in the carousel context line. */
  carouselLabel: string;
  items: BucketedCard[];
  start: number;
}

export function SharedDeckView({ data }: Props) {
  const [search, setSearch] = useState('');
  const [view, setView] = useState<ViewKind>('grid');
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  // Facet options derive from every card in the deck (mainboard + commanders
  // + sideboard), coerced to the PublicCard shape.
  const allCards = useMemo(() => {
    const cards = data.cards.map((slot) => deckCardToPublicCard(slot));
    if (data.commander) cards.push(deckCardToPublicCard({ card: data.commander }));
    if (data.partnerCommander) cards.push(deckCardToPublicCard({ card: data.partnerCommander }));
    for (const slot of data.sideboard) cards.push(deckCardToPublicCard(slot));
    return cards;
  }, [data.cards, data.commander, data.partnerCommander, data.sideboard]);

  // Deck cards carry a placeholder price (0), so the price facet is off here.
  const { filterNode, matches: facetMatches } = useSharedFilters(allCards, { withPrice: false });

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
    (q ? normalizeForSearch(pc.name).includes(q) : true) && facetMatches(pc);

  // Non-empty deck sections in render order (commander → type buckets →
  // sideboard), each stamped with its start offset into the flat carousel list
  // so a tile's local index maps to a global carousel index.
  const deckSections = useMemo(() => {
    const commanders = [commanderCard, partnerCard]
      .filter((c): c is PublicCard => c != null && matches(c))
      .map((c) => ({ publicCard: c, quantity: 1 }));

    const buckets = DECK_BUCKET_ORDER.map((bucket) => {
      const cards = (mainboard.get(bucket) ?? []).filter((b) => matches(b.publicCard));
      const count = cards.reduce((s, b) => s + b.quantity, 0);
      return { key: bucket, heading: `${bucket} (${count})`, carouselLabel: bucket, items: cards };
    });

    const side = sideboardCards.filter((b) => matches(b.publicCard));

    const raw: Array<Omit<DeckSection, 'start'>> = [
      {
        key: 'commander',
        heading: partnerCard ? 'Commanders' : 'Commander',
        carouselLabel: 'Commander',
        items: commanders,
      },
      ...buckets,
      {
        key: 'sideboard',
        heading: `Sideboard (${data.sideboard.length})`,
        carouselLabel: 'Sideboard',
        items: side,
      },
    ].filter((s) => s.items.length > 0);

    // Prefix-sum each section's start offset into the flat carousel list without
    // a render-scope reassignment (React Compiler immutability rule).
    const lengths = raw.map((s) => s.items.length);
    return raw.map((s, i) => ({ ...s, start: lengths.slice(0, i).reduce((a, b) => a + b, 0) }));
    // matches closes over search+facet state; listed via facetMatches + q.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    commanderCard,
    partnerCard,
    mainboard,
    sideboardCards,
    facetMatches,
    q,
    data.sideboard.length,
  ]);

  // Flat card list across all sections (in render order) for the carousel.
  const previewCards = useMemo(
    () => deckSections.flatMap((s) => s.items.map((it) => publicCardToEnriched(it.publicCard))),
    [deckSections]
  );
  const previewLabels = useMemo(
    () => deckSections.flatMap((s) => s.items.map(() => s.carouselLabel)),
    [deckSections]
  );
  const previewQty = useMemo(
    () => deckSections.flatMap((s) => s.items.map((it) => it.quantity)),
    [deckSections]
  );
  const previewPages = useMemo(() => previewCards.map(() => 0), [previewCards]);

  const mainboardCount =
    data.cards.length + (data.commander ? 1 : 0) + (data.partnerCommander ? 1 : 0);

  return (
    <main className="shared-view">
      <header className="shared-view-header">
        <p className="shared-view-owner">Shared by @{data.ownerUsername}</p>
        <h1 className="shared-view-title">{data.name}</h1>
        <p className="shared-view-subtitle">
          {data.format} · {mainboardCount.toLocaleString()} cards
        </p>
      </header>

      <div className="shared-toolbar">
        <SearchPill
          value={search}
          onChange={setSearch}
          placeholder="Search cards in this deck…"
          ariaLabel="Search cards"
          className="shared-toolbar-search"
          trailing={filterNode}
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

      {deckSections.map((s) => (
        <section key={s.key} className="shared-deck-section">
          <h2 className="shared-deck-section-heading">{s.heading}</h2>
          {view === 'grid' ? (
            <ul className="shared-card-grid shared-card-grid--small">
              {s.items.map((it, j) => (
                <li key={`${it.publicCard.scryfallId}-${it.publicCard.name}-${j}`}>
                  <SharedCardTile
                    card={it.publicCard}
                    quantity={it.quantity}
                    onClick={() => setPreviewIndex(s.start + j)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <SharedCardList
              items={s.items.map((it, j) => ({
                key: `${it.publicCard.scryfallId}-${it.publicCard.name}-${j}`,
                card: it.publicCard,
                quantity: it.quantity,
              }))}
              onPreview={(j) => setPreviewIndex(s.start + j)}
              showPrice={false}
            />
          )}
        </section>
      ))}

      <CopyDeckButton data={data} variant="block" />

      {previewIndex !== null && previewCards[previewIndex] && (
        <CardPreview
          source="deck"
          cards={previewCards}
          index={previewIndex}
          binderName={data.name}
          sectionLabels={previewLabels}
          pageNumbers={previewPages}
          totalPages={0}
          getStackQty={(i) => previewQty[i] ?? 1}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </main>
  );
}
