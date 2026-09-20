import { useEffect, useMemo, useRef, useState } from 'react';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { useEscapeKey } from '@/lib/use-escape-key';
import { useSheetExit } from '@/lib/use-sheet-exit';
import type { ScryfallCard } from '@/deck-builder/types';
import {
  resolveTokenOption,
  searchTokens,
  type TokenOption,
} from '@/deck-builder/services/scryfall/client';
import { useDeckTokens } from '@/components/deck/use-deck-tokens';

/** A token the player is creating. `typeLine` matters beyond display — the
 *  board reads it to decide which row a new permanent lands in, so a
 *  "Token Creature — Bird" goes where the creatures are. */
export interface CreatedToken {
  name: string;
  typeLine?: string;
  imageUrl?: string;
}

interface Props {
  /** The deck being played, for the token list. Empty in a session with no
   *  deck behind it, which just means the grid is empty and search is the
   *  whole picker. */
  deckCards: ScryfallCard[];
  onCreate(token: CreatedToken): void;
  onClose(): void;
}

/** Typing pause before a search fires. Long enough that a name typed at
 *  speed is one request, short enough not to feel held back. */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Create a token.
 *
 * Opens on **the deck's own tokens**, because the overwhelming majority of
 * tokens anybody makes are the ones their own deck makes — a Commander deck
 * has a handful, and they are the answer nine times out of ten. The list is
 * the same one the deck page's "Tokens to prep" sheet shows
 * (`lib/deck-tokens`), so a player sees the same set in both places.
 *
 * Search is for everything else: a token somebody else's card made, a Copy,
 * an emblem. It hits Scryfall live, so it is empty offline — the deck grid
 * is not, which is the half that matters at a kitchen table with bad wifi.
 *
 * A name typed by hand and submitted still works and always has. That is the
 * floor this picker must not drop below: no network, no deck, no matching
 * token, and you can still make a "Goblin 1/1" because you said so.
 */
export function TokenCreator({ deckCards, onCreate, onClose }: Props) {
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'binder-sheet-slide-out');
  useLockBodyScroll();
  useEscapeKey(beginClose);
  const [query, setQuery] = useState('');
  // Results carry the term they are FOR, which is what lets "still
  // searching" be derived rather than tracked: if the landed term is not the
  // one in the box, the box is ahead of the network.
  const [results, setResults] = useState<{ term: string; list: TokenOption[] }>({
    term: '',
    list: [],
  });

  const deckTokens = useDeckTokens(deckCards);

  // The deck's tokens carry a name and a type line but no art, so each one
  // is resolved to a full face once per sheet. Keyed by name+type line,
  // which is exactly what makes two different Birds two rows.
  const [faces, setFaces] = useState<Record<string, TokenOption | null>>({});
  const wanted = useMemo(
    () => deckTokens.map((t) => ({ key: `${t.name}|${t.typeLine ?? ''}`, ...t })),
    [deckTokens]
  );
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const t of wanted) {
        if (cancelled) return;
        // Already resolved (or resolved to a miss) — never ask twice.
        if (t.key in faces) continue;
        const face = await resolveTokenOption(t.name, t.typeLine);
        if (cancelled) return;
        setFaces((prev) => (t.key in prev ? prev : { ...prev, [t.key]: face }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // `faces` is deliberately not a dependency: it is written by this effect,
    // and reading it here only skips work already done. Including it would
    // restart the loop on every resolution.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);

  // Debounced search. The request id guards against an earlier, slower
  // response landing after a later one and overwriting it.
  const searchSeq = useRef(0);
  useEffect(() => {
    const term = query.trim();
    // Nothing to search, and nothing to clear: an empty box renders the deck
    // grid, so stale results are never on screen to need blanking.
    if (!term) return;
    const seq = ++searchSeq.current;
    const timer = setTimeout(() => {
      void searchTokens(term).then((found) => {
        if (seq !== searchSeq.current) return;
        setResults({ term, list: found });
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const create = (token: CreatedToken) => {
    onCreate(token);
    beginClose();
  };

  const typed = query.trim();
  const searching = typed !== '' && results.term !== typed;

  return (
    <div className="card-picker-root">
      {/* The backdrop fully covers the root (both `inset: 0`), so it — not
          root — is what a "click outside the sheet" actually lands on. */}
      <div className="card-picker-backdrop" role="presentation" onClick={() => beginClose()} />
      <div
        className={`card-picker-sheet playtest-token-sheet${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Create token"
        onAnimationEnd={onAnimationEnd}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <h2 className="card-picker-title">Create token</h2>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name…"
            className="card-picker-search"
            aria-label="Search for a token by name"
            onKeyDown={(e) => {
              // Enter makes whatever you typed, even with nothing found —
              // the floor this picker never drops below.
              if (e.key === 'Enter' && typed) create({ name: typed });
            }}
            autoFocus
          />
        </div>

        <div className="playtest-token-body">
          {!typed && (
            <TokenGrid
              heading="Deck tokens"
              empty="This deck makes no tokens."
              tokens={wanted.map(
                (t) => faces[t.key] ?? { id: t.key, name: t.name, typeLine: t.typeLine }
              )}
              onPick={create}
            />
          )}

          {typed && (
            <TokenGrid
              heading="Search results"
              empty={searching ? 'Searching…' : `No token called “${typed}”.`}
              tokens={searching ? [] : results.list}
              onPick={create}
            />
          )}
        </div>

        <div className="card-picker-footer">
          {/* Always available, never gated on a search landing. */}
          <button
            type="button"
            className="btn btn-primary"
            disabled={!typed}
            onClick={() => create({ name: typed })}
          >
            Create “{typed || 'token'}”
          </button>
        </div>
      </div>
    </div>
  );
}

function TokenGrid({
  heading,
  empty,
  tokens,
  onPick,
}: {
  heading: string;
  empty: string;
  tokens: TokenOption[];
  onPick(token: CreatedToken): void;
}) {
  return (
    <section className="playtest-token-section">
      <h3 className="playtest-token-heading">{heading}</h3>
      {tokens.length === 0 ? (
        <p className="playtest-token-empty">{empty}</p>
      ) : (
        <ul className="playtest-token-grid">
          {tokens.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className="playtest-token-tile"
                onClick={() =>
                  onPick({
                    name: t.name,
                    ...(t.typeLine !== undefined && { typeLine: t.typeLine }),
                    ...(t.imageUrl !== undefined && { imageUrl: t.imageUrl }),
                  })
                }
              >
                {t.imageUrl ? (
                  <img src={t.imageUrl} alt="" loading="lazy" decoding="async" draggable={false} />
                ) : (
                  // The face has not resolved, or there is none. An empty
                  // box of the same size rather than the name again — the
                  // name is already printed below, and art is the
                  // enhancement here, never the thing being picked.
                  <span className="playtest-token-tile__placeholder" aria-hidden />
                )}
                <span className="playtest-token-tile__name">{t.name}</span>
                {t.typeLine && <span className="playtest-token-tile__type">{t.typeLine}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
