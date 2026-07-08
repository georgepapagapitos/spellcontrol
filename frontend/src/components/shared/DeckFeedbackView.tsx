import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Scissors, Undo2 } from 'lucide-react';
import type { PublicDeck, PublicDeckCard } from '../../lib/shared-types';
import { deckBucketFor, DECK_BUCKET_ORDER } from '../../lib/shared-grouping';
import { normalizeForSearch } from '../../lib/normalize-search';
import { useSearchCards } from '../../lib/use-search-cards';
import { submitFeedback, type DraftSuggestion } from '../../lib/feedback-client';
import { imageFromCard } from '../../lib/card-thumbs';
import { useAuth } from '../../store/auth';
import { SearchPill } from '../SearchPill';
import type { ScryfallCard } from '@/deck-builder/types';

interface Props {
  data: PublicDeck;
  token: string;
}

/** One reviewable deck entry, keyed by oracle identity (falls back to name). */
interface FeedbackRow {
  key: string;
  name: string;
  typeLine?: string;
  manaCost?: string;
  oracleId?: string;
  scryfallId?: string;
  imageSmall?: string;
  quantity: number;
}

function rowFromSlot(slot: PublicDeckCard): FeedbackRow {
  const c = slot.card;
  const img = (c.image_uris ?? c.card_faces?.[0]?.image_uris ?? {}) as { small?: string };
  const oracleId = typeof c.oracle_id === 'string' ? c.oracle_id : undefined;
  return {
    key: oracleId ?? c.name,
    name: c.name,
    typeLine: typeof c.type_line === 'string' ? c.type_line : undefined,
    manaCost: typeof c.mana_cost === 'string' ? c.mana_cost : undefined,
    oracleId,
    scryfallId: typeof c.id === 'string' ? c.id : undefined,
    imageSmall: img.small,
    quantity: 1,
  };
}

const BRACKETS = [1, 2, 3, 4, 5] as const;
const BRACKET_LABELS: Record<number, string> = {
  1: 'Exhibition',
  2: 'Core',
  3: 'Upgraded',
  4: 'Optimized',
  5: 'cEDH',
};

/**
 * Suggestion-mode view of a feedback share (/s/:token, kind='feedback') —
 * the BlueprintMTG-style Feedback Tool. Recipients tap any card to suggest
 * cutting it, search to suggest additions, then attach a comment and a
 * power-bracket read and submit. All state is local until submit; nothing
 * writes to the owner's stores.
 */
export function DeckFeedbackView({ data, token }: Props) {
  const isAuthed = useAuth((s) => s.status === 'authed');
  const [cuts, setCuts] = useState<Map<string, FeedbackRow>>(new Map());
  const [adds, setAdds] = useState<ScryfallCard[]>([]);
  const [addQuery, setAddQuery] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [comment, setComment] = useState('');
  const [bracket, setBracket] = useState<number | null>(null);
  const [submitState, setSubmitState] = useState<
    { status: 'idle' } | { status: 'sending' } | { status: 'sent' } | { status: 'error'; message: string }
  >({ status: 'idle' });

  const { results: searchResults, loading: searching } = useSearchCards<ScryfallCard>(addQuery, {
    limit: 12,
  });

  // Stack duplicate printings (basics, etc.) into one row per oracle identity.
  const sections = useMemo(() => {
    const byBucket = new Map<string, Map<string, FeedbackRow>>();
    for (const slot of data.cards) {
      const row = rowFromSlot(slot);
      const bucket = deckBucketFor(row.typeLine);
      const rows = byBucket.get(bucket) ?? new Map<string, FeedbackRow>();
      const existing = rows.get(row.key);
      if (existing) existing.quantity += 1;
      else rows.set(row.key, row);
      byBucket.set(bucket, rows);
    }
    return DECK_BUCKET_ORDER.map((bucket) => ({
      key: bucket,
      rows: Array.from(byBucket.get(bucket)?.values() ?? []),
    })).filter((s) => s.rows.length > 0);
  }, [data.cards]);

  const deckNameKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const slot of data.cards) keys.add(normalizeForSearch(slot.card.name));
    if (data.commander) keys.add(normalizeForSearch(data.commander.name));
    if (data.partnerCommander) keys.add(normalizeForSearch(data.partnerCommander.name));
    return keys;
  }, [data.cards, data.commander, data.partnerCommander]);

  const toggleCut = (row: FeedbackRow) => {
    setCuts((prev) => {
      const next = new Map(prev);
      if (next.has(row.key)) next.delete(row.key);
      else next.set(row.key, row);
      return next;
    });
  };

  const addSuggestion = (card: ScryfallCard) => {
    if (deckNameKeys.has(normalizeForSearch(card.name))) return;
    setAdds((prev) =>
      prev.some((c) => c.oracle_id === card.oracle_id) ? prev : [...prev, card]
    );
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
      ...Array.from(cuts.values()).map((row) => ({
        type: 'cut' as const,
        cardName: row.name,
        oracleId: row.oracleId,
        scryfallId: row.scryfallId,
        imageUrl: row.imageSmall,
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
        Tap any card to suggest cutting it. Search below to suggest additions. Your suggestions are
        collected and sent when you submit — nothing changes the deck until the owner accepts.
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
                    <span className="feedback-row-name">{card.name}</span>
                    <span className="feedback-row-type">
                      {inDeck ? 'Already in deck' : (card.type_line ?? '')}
                    </span>
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
                  className="feedback-row feedback-row--add"
                  onClick={() => removeAdd(card.oracle_id)}
                  title="Remove this suggestion"
                >
                  <Plus width={14} height={14} strokeWidth={2} aria-hidden />
                  <span className="feedback-row-name">{card.name}</span>
                  <span className="feedback-row-type">{card.type_line ?? ''}</span>
                  <Undo2 width={14} height={14} strokeWidth={2} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {sections.map((section) => (
        <section key={section.key} className="shared-deck-section">
          <h2 className="shared-deck-section-heading">
            {section.key} ({section.rows.reduce((n, r) => n + r.quantity, 0)})
          </h2>
          <ul className="feedback-rows">
            {section.rows.map((row) => {
              const isCut = cuts.has(row.key);
              return (
                <li key={row.key}>
                  <button
                    type="button"
                    className={`feedback-row${isCut ? ' feedback-row--cut' : ''}`}
                    onClick={() => toggleCut(row)}
                    aria-pressed={isCut}
                    title={isCut ? 'Undo cut suggestion' : 'Suggest cutting this card'}
                  >
                    {isCut ? (
                      <Undo2 width={14} height={14} strokeWidth={2} aria-hidden />
                    ) : (
                      <Scissors width={14} height={14} strokeWidth={2} aria-hidden />
                    )}
                    <span className="feedback-row-name">
                      {row.quantity > 1 ? `${row.quantity}× ` : ''}
                      {row.name}
                    </span>
                    <span className="feedback-row-type">{isCut ? 'Suggested cut' : ''}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <section className="feedback-form">
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
    </main>
  );
}
