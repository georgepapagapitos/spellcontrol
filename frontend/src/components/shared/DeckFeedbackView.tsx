import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { LayoutGrid, List as ListIcon, Plus, Scissors, Undo2 } from 'lucide-react';
import type { PublicCard, PublicDeck } from '../../lib/shared-types';
import { deckBucketFor, DECK_BUCKET_ORDER } from '../../lib/shared-grouping';
import { normalizeForSearch } from '../../lib/normalize-search';
import { useSearchCards } from '../../lib/use-search-cards';
import { submitFeedback, type DraftSuggestion } from '../../lib/feedback-client';
import { imageFromCard } from '../../lib/card-thumbs';
import { publicCardToEnriched } from '../../lib/shared-filter';
import { useAuth } from '../../store/auth';
import { CardPreview, type CardPreviewAction } from '../CardPreview';
import { ManaCost } from '../ManaCost';
import { SearchPill } from '../SearchPill';
import { ViewModeToggle } from '../ViewModeToggle';
import { SharedCardTile } from './SharedCardTile';
import { deckCardToPublicCard } from './SharedDeckView';
import { useSharedFilters } from './use-shared-filters';
import type { ScryfallCard } from '@/deck-builder/types';

interface Props {
  data: PublicDeck;
  token: string;
}

/** One reviewable deck entry, keyed by oracle identity (falls back to name). */
interface ReviewItem {
  key: string;
  pc: PublicCard;
  quantity: number;
}

/** One rendered deck section with its start offset into the flat carousel
 *  list (same prefix-sum pattern as SharedDeckView). Commanders render for
 *  context but take no cut suggestions. */
interface ReviewSection {
  key: string;
  heading: string;
  carouselLabel: string;
  cuttable: boolean;
  items: ReviewItem[];
  start: number;
}

type ViewKind = 'grid' | 'list';

const BRACKETS = [1, 2, 3, 4, 5] as const;
const BRACKET_LABELS: Record<number, string> = {
  1: 'Exhibition',
  2: 'Core',
  3: 'Upgraded',
  4: 'Optimized',
  5: 'cEDH',
};

function itemFromPc(pc: PublicCard): ReviewItem {
  return { key: pc.oracleId ?? pc.name, pc, quantity: 1 };
}

/** Card thumb for the dense suggestion rows (E128 pick-list thumb sizing). */
function RowThumb({ src }: { src?: string }) {
  return src ? (
    <img src={src} alt="" loading="lazy" className="feedback-row-thumb" />
  ) : (
    <span className="feedback-row-thumb feedback-row-thumb--ph" aria-hidden />
  );
}

/**
 * Suggestion-mode view of a feedback share (/s/:token, kind='feedback') —
 * the BlueprintMTG-style Feedback Tool. Card-forward like SharedDeckView:
 * grid of card art (or a list with thumbs), tap a card to read it in the
 * CardPreview carousel, and an explicit scissors toggle marks a cut. Search
 * suggests additions; a sticky tally pill keeps the pending suggestions and
 * the path to submit in reach on long decks. All state is local until
 * submit; nothing writes to the owner's stores.
 */
export function DeckFeedbackView({ data, token }: Props) {
  const isAuthed = useAuth((s) => s.status === 'authed');
  const [cuts, setCuts] = useState<Map<string, ReviewItem>>(new Map());
  const [adds, setAdds] = useState<ScryfallCard[]>([]);
  const [addQuery, setAddQuery] = useState('');
  const [search, setSearch] = useState('');
  const [view, setView] = useState<ViewKind>('grid');
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [authorName, setAuthorName] = useState('');
  const [comment, setComment] = useState('');
  const [bracket, setBracket] = useState<number | null>(null);
  const formRef = useRef<HTMLElement | null>(null);
  const [submitState, setSubmitState] = useState<
    | { status: 'idle' }
    | { status: 'sending' }
    | { status: 'sent' }
    | { status: 'error'; message: string }
  >({ status: 'idle' });

  const { results: searchResults, loading: searching } = useSearchCards<ScryfallCard>(addQuery, {
    limit: 12,
  });

  // Commanders (context, not cuttable) + mainboard stacked into one row per
  // oracle identity (basics, etc.), grouped by type bucket.
  const base = useMemo(() => {
    const commanders = [data.commander, data.partnerCommander]
      .filter((c): c is NonNullable<typeof c> => c != null)
      .map((c) => itemFromPc(deckCardToPublicCard({ card: c })));
    const byBucket = new Map<string, Map<string, ReviewItem>>();
    for (const slot of data.cards) {
      const item = itemFromPc(deckCardToPublicCard(slot));
      const bucket = deckBucketFor(item.pc.typeLine);
      const rows = byBucket.get(bucket) ?? new Map<string, ReviewItem>();
      const existing = rows.get(item.key);
      if (existing) existing.quantity += 1;
      else rows.set(item.key, item);
      byBucket.set(bucket, rows);
    }
    const buckets = DECK_BUCKET_ORDER.map((bucket) => ({
      key: bucket as string,
      items: Array.from(byBucket.get(bucket)?.values() ?? []),
    }));
    return { commanders, buckets };
  }, [data.cards, data.commander, data.partnerCommander]);

  const allCards = useMemo(
    () => [...base.commanders, ...base.buckets.flatMap((b) => b.items)].map((it) => it.pc),
    [base]
  );

  // Deck cards carry no real price, so the price facet is off (as in
  // SharedDeckView).
  const { filterNode, matches: facetMatches } = useSharedFilters(allCards, { withPrice: false });

  const sections: ReviewSection[] = useMemo(() => {
    const q = normalizeForSearch(search);
    const matches = (pc: PublicCard) =>
      (q ? normalizeForSearch(pc.name).includes(q) : true) && facetMatches(pc);
    const commanders = base.commanders.filter((it) => matches(it.pc));
    const raw = [
      {
        key: 'commander',
        heading: base.commanders.length > 1 ? 'Commanders' : 'Commander',
        carouselLabel: 'Commander',
        cuttable: false,
        items: commanders,
      },
      ...base.buckets.map((b) => {
        const items = b.items.filter((it) => matches(it.pc));
        const count = items.reduce((n, it) => n + it.quantity, 0);
        return {
          key: b.key,
          heading: `${b.key} (${count})`,
          carouselLabel: b.key,
          cuttable: true,
          items,
        };
      }),
    ].filter((s) => s.items.length > 0);
    const lengths = raw.map((s) => s.items.length);
    return raw.map((s, i) => ({ ...s, start: lengths.slice(0, i).reduce((a, b) => a + b, 0) }));
  }, [base, facetMatches, search]);

  // Flat list across all sections (render order) for the carousel.
  const flat = useMemo(
    () => sections.flatMap((s) => s.items.map((it) => ({ item: it, cuttable: s.cuttable }))),
    [sections]
  );
  const previewCards = useMemo(() => flat.map((f) => publicCardToEnriched(f.item.pc)), [flat]);
  const previewLabels = useMemo(
    () => sections.flatMap((s) => s.items.map(() => s.carouselLabel)),
    [sections]
  );
  const previewPages = useMemo(() => previewCards.map(() => 0), [previewCards]);

  const deckNameKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const pc of allCards) keys.add(normalizeForSearch(pc.name));
    return keys;
  }, [allCards]);

  const toggleCut = (item: ReviewItem) => {
    setCuts((prev) => {
      const next = new Map(prev);
      if (next.has(item.key)) next.delete(item.key);
      else next.set(item.key, item);
      return next;
    });
  };

  const addSuggestion = (card: ScryfallCard) => {
    if (deckNameKeys.has(normalizeForSearch(card.name))) return;
    setAdds((prev) => (prev.some((c) => c.oracle_id === card.oracle_id) ? prev : [...prev, card]));
    setAddQuery('');
  };

  const removeAdd = (oracleId: string) => {
    setAdds((prev) => prev.filter((c) => c.oracle_id !== oracleId));
  };

  const suggestionCount = cuts.size + adds.length;
  const canSubmit =
    submitState.status !== 'sending' &&
    (suggestionCount > 0 || comment.trim().length > 0) &&
    (isAuthed || authorName.trim().length > 0);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitState({ status: 'sending' });
    const suggestions: DraftSuggestion[] = [
      ...Array.from(cuts.values()).map((it) => ({
        type: 'cut' as const,
        cardName: it.pc.name,
        oracleId: it.pc.oracleId,
        scryfallId: it.pc.scryfallId || undefined,
        imageUrl: it.pc.imageSmall,
      })),
      ...adds.map((card) => ({
        type: 'add' as const,
        cardName: card.name,
        oracleId: card.oracle_id,
        scryfallId: card.id,
        imageUrl: imageFromCard(card, 'small'),
        card,
      })),
    ];
    try {
      await submitFeedback(token, {
        authorName: authorName.trim() || undefined,
        comment: comment.trim() || undefined,
        bracketSuggestion: bracket,
        suggestions,
      });
      setSubmitState({ status: 'sent' });
    } catch (err) {
      setSubmitState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Failed to submit feedback.',
      });
    }
  };

  if (submitState.status === 'sent') {
    return (
      <main className="shared-view feedback-view">
        <div className="feedback-sent" role="status">
          <h1>Feedback sent</h1>
          <p>
            Thanks! @{data.ownerUsername} will see your{' '}
            {suggestionCount > 0
              ? `${suggestionCount} suggestion${suggestionCount === 1 ? '' : 's'}`
              : 'comment'}{' '}
            and can apply each one with a tap.
          </p>
          <Link to="/" className="btn btn-primary shared-copy-btn">
            Try SpellControl
          </Link>
        </div>
      </main>
    );
  }

  const mainboardCount =
    data.cards.length + (data.commander ? 1 : 0) + (data.partnerCommander ? 1 : 0);

  const scrollToForm = () => {
    formRef.current?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    });
  };

  const tallyParts = [
    cuts.size > 0 ? `${cuts.size} cut${cuts.size === 1 ? '' : 's'}` : null,
    adds.length > 0 ? `${adds.length} add${adds.length === 1 ? '' : 's'}` : null,
  ].filter(Boolean);

  return (
    <main className="shared-view feedback-view">
      <header className="shared-view-header">
        <p className="shared-view-owner">@{data.ownerUsername} is asking for feedback</p>
        <h1 className="shared-view-title">{data.name}</h1>
        <p className="shared-view-subtitle">
          {data.format} · {mainboardCount.toLocaleString()} cards
        </p>
      </header>

      <p className="feedback-howto">
        Tap any card to read it in full — the scissors marks it as a suggested cut. Search below to
        suggest additions. Your suggestions are collected and sent when you submit — nothing changes
        the deck until the owner accepts.
      </p>

      <section className="feedback-add">
        <SearchPill
          value={addQuery}
          onChange={setAddQuery}
          placeholder="Suggest a card to add (name or Scryfall syntax)…"
          ariaLabel="Search cards to suggest adding"
          className="feedback-add-search"
        />
        {addQuery.trim().length >= 2 && (
          <ul className="feedback-add-results" aria-busy={searching}>
            {searching && searchResults.length === 0 && (
              <li className="feedback-add-empty">Searching…</li>
            )}
            {!searching && searchResults.length === 0 && (
              <li className="feedback-add-empty">No cards found.</li>
            )}
            {searchResults.map((card) => {
              const inDeck = deckNameKeys.has(normalizeForSearch(card.name));
              return (
                <li key={card.id}>
                  <button
                    type="button"
                    className="feedback-add-result"
                    onClick={() => addSuggestion(card)}
                    disabled={inDeck}
                  >
                    <Plus width={14} height={14} strokeWidth={2} aria-hidden />
                    <RowThumb src={imageFromCard(card, 'small')} />
                    <span className="feedback-row-name">{card.name}</span>
                    <span className="feedback-row-type">
                      {inDeck ? 'Already in deck' : (card.type_line ?? '')}
                    </span>
                    {typeof card.mana_cost === 'string' && (
                      <ManaCost cost={card.mana_cost} className="feedback-row-mana" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {adds.length > 0 && (
        <section className="shared-deck-section">
          <h2 className="shared-deck-section-heading">Suggested additions ({adds.length})</h2>
          <ul className="feedback-rows">
            {adds.map((card) => (
              <li key={card.oracle_id}>
                <button
                  type="button"
                  className="feedback-add-result feedback-row--add"
                  onClick={() => removeAdd(card.oracle_id)}
                  title="Remove this suggestion"
                >
                  <Plus width={14} height={14} strokeWidth={2} aria-hidden />
                  <RowThumb src={imageFromCard(card, 'small')} />
                  <span className="feedback-row-name">{card.name}</span>
                  <span className="feedback-row-type">{card.type_line ?? ''}</span>
                  {typeof card.mana_cost === 'string' && (
                    <ManaCost cost={card.mana_cost} className="feedback-row-mana" />
                  )}
                  <Undo2 width={14} height={14} strokeWidth={2} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="shared-toolbar">
        <SearchPill
          value={search}
          onChange={setSearch}
          placeholder="Search cards in this deck…"
          ariaLabel="Search cards in this deck"
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

      {sections.length === 0 && <p className="feedback-add-empty">No cards match your search.</p>}

      {sections.map((s) => (
        <section key={s.key} className="shared-deck-section">
          <h2 className="shared-deck-section-heading">{s.heading}</h2>
          {view === 'grid' ? (
            <ul className="shared-card-grid shared-card-grid--small">
              {s.items.map((it, j) => {
                const isCut = cuts.has(it.key);
                return (
                  <li key={it.key} className={`feedback-tile${isCut ? ' is-cut' : ''}`}>
                    <SharedCardTile
                      card={it.pc}
                      quantity={it.quantity}
                      onClick={() => setPreviewIndex(s.start + j)}
                    />
                    {s.cuttable && (
                      <button
                        type="button"
                        className="feedback-tile-cut"
                        aria-pressed={isCut}
                        aria-label={
                          isCut
                            ? `Undo cut suggestion for ${it.pc.name}`
                            : `Suggest cutting ${it.pc.name}`
                        }
                        onClick={() => toggleCut(it)}
                      >
                        {isCut ? (
                          <Undo2 width={15} height={15} strokeWidth={2} aria-hidden />
                        ) : (
                          <Scissors width={15} height={15} strokeWidth={2} aria-hidden />
                        )}
                      </button>
                    )}
                    {isCut && (
                      <span className="feedback-tile-chip" aria-hidden>
                        Cut
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <ul className="feedback-rows">
              {s.items.map((it, j) => {
                const isCut = cuts.has(it.key);
                return (
                  <li key={it.key} className={`feedback-row${isCut ? ' feedback-row--cut' : ''}`}>
                    <button
                      type="button"
                      className="feedback-row-main"
                      onClick={() => setPreviewIndex(s.start + j)}
                    >
                      <RowThumb src={it.pc.imageSmall} />
                      <span className="feedback-row-name">
                        {it.quantity > 1 ? `${it.quantity}× ` : ''}
                        {it.pc.name}
                      </span>
                      <span className="feedback-row-type">
                        {isCut ? 'Suggested cut' : (it.pc.typeLine ?? '')}
                      </span>
                      <ManaCost cost={it.pc.manaCost} className="feedback-row-mana" />
                    </button>
                    {s.cuttable && (
                      <button
                        type="button"
                        className="feedback-row-cutbtn"
                        aria-pressed={isCut}
                        aria-label={
                          isCut
                            ? `Undo cut suggestion for ${it.pc.name}`
                            : `Suggest cutting ${it.pc.name}`
                        }
                        onClick={() => toggleCut(it)}
                      >
                        {isCut ? (
                          <Undo2 width={15} height={15} strokeWidth={2} aria-hidden />
                        ) : (
                          <Scissors width={15} height={15} strokeWidth={2} aria-hidden />
                        )}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}

      {suggestionCount > 0 && (
        <div className="feedback-tally">
          <span className="feedback-tally-count">{tallyParts.join(' · ')}</span>
          <button type="button" className="btn btn-primary" onClick={scrollToForm}>
            Review &amp; send
          </button>
        </div>
      )}

      <section className="feedback-form" ref={formRef}>
        <h2 className="shared-deck-section-heading">Your feedback</h2>
        {!isAuthed && (
          <label className="feedback-field">
            <span>Your name</span>
            <input
              type="text"
              value={authorName}
              maxLength={40}
              onChange={(e) => setAuthorName(e.target.value)}
              placeholder="So the owner knows who's advising"
            />
          </label>
        )}
        <div className="feedback-field">
          <span id="feedback-bracket-label">Power bracket read (optional)</span>
          <div className="feedback-brackets" role="group" aria-labelledby="feedback-bracket-label">
            {BRACKETS.map((b) => (
              <button
                key={b}
                type="button"
                className={`feedback-bracket${bracket === b ? ' is-active' : ''}`}
                aria-pressed={bracket === b}
                onClick={() => setBracket(bracket === b ? null : b)}
              >
                {b}
                <small>{BRACKET_LABELS[b]}</small>
              </button>
            ))}
          </div>
        </div>
        <label className="feedback-field">
          <span>Comments</span>
          <textarea
            value={comment}
            maxLength={4000}
            rows={4}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Overall thoughts, lines to consider, meta context…"
          />
        </label>
        {submitState.status === 'error' && (
          <p role="alert" className="feedback-error">
            {submitState.message}
          </p>
        )}
        <button
          type="button"
          className="btn btn-primary feedback-submit"
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          {submitState.status === 'sending'
            ? 'Sending…'
            : suggestionCount > 0
              ? `Send feedback (${suggestionCount} suggestion${suggestionCount === 1 ? '' : 's'})`
              : 'Send feedback'}
        </button>
      </section>

      {previewIndex !== null && previewCards[previewIndex] && (
        <CardPreview
          source="deck"
          cards={previewCards}
          index={previewIndex}
          binderName={data.name}
          sectionLabels={previewLabels}
          pageNumbers={previewPages}
          totalPages={0}
          getStackQty={(i) => flat[i]?.item.quantity ?? 1}
          getActions={(i): CardPreviewAction[] => {
            const f = flat[i];
            if (!f || !f.cuttable) return [];
            const isCut = cuts.has(f.item.key);
            return [
              {
                key: 'cut',
                label: isCut ? 'Undo cut' : 'Suggest cut',
                danger: !isCut,
                icon: isCut ? (
                  <Undo2 width={18} height={18} strokeWidth={2} aria-hidden />
                ) : (
                  <Scissors width={18} height={18} strokeWidth={2} aria-hidden />
                ),
                onClick: () => toggleCut(f.item),
              },
            ];
          }}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </main>
  );
}
