import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Dices, X } from 'lucide-react';
import { Modal } from '../Modal';
import { SearchPill } from '../SearchPill';
import { Tabs } from '../Tabs';
import { ManaCost } from '../ManaCost';
import { deckPickerLabels } from '../../lib/deck-picker-labels';
import { searchStarterDecks, starterDeckLocalId } from '../../lib/starter-decks';
import {
  colorIdentityCost,
  colorIdentityLabel,
  ensureProductCommander,
  useProductCommander,
} from '../../lib/use-product-commander';
import { userMessage } from '../../lib/user-error';
import { effectiveBracket, type Deck } from '../../store/decks';
import { bracketTextWithEstimate } from '../../lib/format-bracket-label';
import type { ProductSummary } from '../../types';
import { IconButton } from '@/components/shared/Button';
import './DeckPickerDialog.css';

/**
 * What a seat needs to know about the deck behind it. A saved deck and a
 * starter deck agree on exactly this much, which is what lets one picker
 * offer both: the roster shows a name, a commander and the colors, and only
 * the player who owns the seat ever resolves the cards (on the way to their
 * board).
 */
export interface PickedDeck {
  id: string;
  name: string;
  commander: string | null;
  partner: string | null;
  colorIdentity: string[];
  /**
   * The deck's bracket at pick time (owner's declared `bracketOverride`, else
   * the last computed `bracketEstimation`) — see `effectiveBracket`. Null
   * when neither is known yet (a fresh deck that has never been analyzed, or
   * a starter deck, whose estimate isn't computed here). Carried through so
   * the seat can publish it to the table (board E370) without the server
   * ever needing the deck's cards or tag data.
   */
  bracket: 1 | 2 | 3 | 4 | 5 | null;
}

function pickedFromDeck(deck: Deck): PickedDeck {
  return {
    id: deck.id,
    name: deck.name,
    commander: deck.commander?.name ?? null,
    // Decks already model the second commander, so a Partner pair shows both.
    partner: deck.partnerCommander?.name ?? null,
    colorIdentity: deck.commander?.color_identity ?? [],
    bracket: (effectiveBracket(deck) as 1 | 2 | 3 | 4 | 5 | undefined) ?? null,
  };
}

type TabId = 'mine' | 'starters';

/** How long to wait after a keystroke before searching the starter catalog. */
const SEARCH_DEBOUNCE_MS = 300;

interface Props {
  decks: Deck[];
  /** The currently picked deck id, so the open dialog marks it. */
  value: string | null;
  onPick: (picked: PickedDeck | null) => void;
  onClose: () => void;
  /**
   * Tab to open on. Defaults to your own decks, or the starters when you have
   * none — the empty case is the whole reason the starter tab exists.
   */
  initialTab?: TabId;
  /** Hide the "My decks" tab entirely (the Decks index' "Play a starter" door). */
  startersOnly?: boolean;
}

/**
 * The deck picker every seat opens: your decks and the preconstructed starter
 * decks, in one overlay with one search field and one randomizer.
 *
 * It replaced a bare `SelectMenu` of your own decks. A select can't hold the
 * starter catalog (hundreds of precons, searched on the server) and gave a new
 * account a list with nothing in it, which is the one account that most needs
 * something to play.
 */
export function DeckPickerDialog({
  decks,
  value,
  onPick,
  onClose,
  initialTab,
  startersOnly = false,
}: Props) {
  const labelId = useId();
  const [tab, setTab] = useState<TabId>(
    () => initialTab ?? (startersOnly || decks.length === 0 ? 'starters' : 'mine')
  );
  const [query, setQuery] = useState('');

  const choose = (picked: PickedDeck | null) => {
    onPick(picked);
    onClose();
  };

  return (
    <Modal onClose={onClose} className="modal deck-picker-modal" labelledBy={labelId}>
      <div className="modal-header deck-picker-header">
        <h2 id={labelId}>{startersOnly ? 'Pick a starter deck' : 'Pick a deck'}</h2>
        <IconButton
          className="modal-close"
          onClick={onClose}
          label="Close"
          icon={<X width={20} height={20} strokeWidth={1.8} />}
        />
      </div>
      <div className="modal-body deck-picker-body">
        {!startersOnly && (
          <Tabs<TabId>
            ariaLabel="Deck source"
            value={tab}
            onChange={(next) => {
              setTab(next);
              setQuery('');
            }}
            tabs={[
              { id: 'mine', label: 'My decks', count: decks.length, controls: 'deck-picker-panel' },
              { id: 'starters', label: 'Starter decks', controls: 'deck-picker-panel' },
            ]}
          />
        )}
        <div
          className="deck-picker-panel"
          id="deck-picker-panel"
          role="tabpanel"
          aria-labelledby={startersOnly ? undefined : `sc-tab-${tab}`}
        >
          {tab === 'mine' ? (
            <MyDecksTab
              decks={decks}
              value={value}
              query={query}
              onQuery={setQuery}
              onChoose={choose}
            />
          ) : (
            <StarterDecksTab value={value} query={query} onQuery={setQuery} onChoose={choose} />
          )}
        </div>
      </div>
    </Modal>
  );
}

/** The search pill and the randomizer, which every tab puts in the same place. */
function PickerSearch({
  query,
  onQuery,
  placeholder,
  onRandom,
  randomDisabled,
}: {
  query: string;
  onQuery: (next: string) => void;
  placeholder: string;
  onRandom: () => void;
  randomDisabled: boolean;
}) {
  return (
    <div className="deck-picker-search">
      <SearchPill
        value={query}
        onChange={onQuery}
        placeholder={placeholder}
        ariaLabel={placeholder}
        className="deck-picker-search-pill"
      />
      <IconButton
        variant="secondary"
        className="deck-picker-random"
        onClick={onRandom}
        disabled={randomDisabled}
        label="Pick a random deck"
        icon={<Dices width={18} height={18} strokeWidth={1.8} />}
      />
    </div>
  );
}

function MyDecksTab({
  decks,
  value,
  query,
  onQuery,
  onChoose,
}: {
  decks: Deck[];
  value: string | null;
  query: string;
  onQuery: (next: string) => void;
  onChoose: (picked: PickedDeck | null) => void;
}) {
  // Same-named decks behind the same commander are the common case for
  // generated decks — the labels are made distinct in deckPickerLabels.
  const labels = useMemo(() => deckPickerLabels(decks), [decks]);
  const needle = query.trim().toLowerCase();
  const shown = decks
    .map((deck, i) => ({ deck, label: labels[i] }))
    .filter(
      ({ deck, label }) =>
        !needle ||
        label.toLowerCase().includes(needle) ||
        (deck.commander?.name ?? '').toLowerCase().includes(needle)
    );

  return (
    <>
      <PickerSearch
        query={query}
        onQuery={onQuery}
        placeholder="Search by deck name"
        onRandom={() =>
          onChoose(pickedFromDeck(shown[Math.floor(Math.random() * shown.length)].deck))
        }
        randomDisabled={shown.length < 2}
      />
      {decks.length === 0 ? (
        <p className="deck-picker-empty">
          You have no decks yet. The starter decks are ready to play without building one.
        </p>
      ) : shown.length === 0 ? (
        <p className="deck-picker-empty">No deck of yours matches that.</p>
      ) : (
        <ul className="deck-picker-list">
          {value && (
            <li>
              <button
                type="button"
                className="deck-picker-row deck-picker-row-clear"
                onClick={() => onChoose(null)}
              >
                <span className="deck-picker-row-name">No deck</span>
              </button>
            </li>
          )}
          {shown.map(({ deck, label }) => {
            const bracket = effectiveBracket(deck);
            // A stated bracket that differs from the estimate carries the
            // estimate alongside it — this list is what shows up when a
            // teammate/opponent chooses a deck for the table (2026-09-24
            // ruling). On Auto, bracket already IS the estimate.
            const estimate = deck.bracketEstimation?.bracket;
            const bracketText =
              bracket !== undefined
                ? deck.bracketOverride != null && estimate != null && estimate !== bracket
                  ? bracketTextWithEstimate(bracket, estimate)
                  : `Bracket ${bracket}`
                : undefined;
            return (
              <li key={deck.id}>
                <button
                  type="button"
                  className="deck-picker-row"
                  aria-current={deck.id === value || undefined}
                  onClick={() => onChoose(pickedFromDeck(deck))}
                >
                  <span className="deck-picker-row-text">
                    <span className="deck-picker-row-name">{deck.name}</span>
                    {deck.commander && (
                      <span className="deck-picker-row-meta">{deck.commander.name}</span>
                    )}
                  </span>
                  {label !== deck.name && <span className="sr-only">{label}</span>}
                  {bracketText && <span className="deck-picker-row-bracket">{bracketText}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function StarterDecksTab({
  value,
  query,
  onQuery,
  onChoose,
}: {
  value: string | null;
  query: string;
  onQuery: (next: string) => void;
  onChoose: (picked: PickedDeck) => void;
}) {
  const [results, setResults] = useState<ProductSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);

  // Debounced catalog search. An empty query lists the newest precons, so the
  // tab is browsable rather than a blank box demanding a name.
  useEffect(() => {
    let cancelled = false;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const products = await searchStarterDecks(query.trim());
        if (!cancelled) setResults(products);
      } catch (e) {
        if (!cancelled) {
          setError(userMessage(e, "Couldn't load the starter decks. Check your connection."));
          setResults([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query]);

  // A starter's commander is what the roster shows the rest of the table, so
  // it is resolved before the pick lands — cache-first, so a row that already
  // enriched itself picks without a round-trip.
  const pick = async (product: ProductSummary) => {
    setPicking(product.fileName);
    const summary = await ensureProductCommander(product.fileName);
    onChoose({
      id: starterDeckLocalId(product.fileName),
      name: product.name,
      commander: summary?.name ?? null,
      // MTGJSON gives a precon one commander; a Partner precon plays its
      // second commander out of the 99, which is wrong at a table and not
      // ours to guess.
      partner: null,
      colorIdentity: summary?.colorIdentity ?? [],
      // A starter's bracket isn't estimated here (no owned Deck record to
      // hang a persisted estimate off of) — never a guess, so it's absent.
      bracket: null,
    });
  };

  return (
    <>
      <PickerSearch
        query={query}
        onQuery={onQuery}
        placeholder="Search by deck name"
        onRandom={() => void pick(results[Math.floor(Math.random() * results.length)])}
        randomDisabled={loading || results.length < 2}
      />
      {error ? (
        <p className="deck-picker-empty" role="alert">
          {error}
        </p>
      ) : loading ? (
        <p className="deck-picker-empty">
          <span className="spinner" aria-hidden="true" /> Loading the starter decks…
        </p>
      ) : results.length === 0 ? (
        <p className="deck-picker-empty">No starter deck matches that.</p>
      ) : (
        <ul className="deck-picker-list">
          {results.map((product) => (
            <StarterRow
              key={product.fileName}
              product={product}
              picked={starterDeckLocalId(product.fileName) === value}
              busy={picking === product.fileName}
              onPick={pick}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function StarterRow({
  product,
  picked,
  busy,
  onPick,
}: {
  product: ProductSummary;
  picked: boolean;
  busy: boolean;
  onPick: (product: ProductSummary) => void;
}) {
  const { summary, ref } = useProductCommander<HTMLLIElement>(product.fileName);
  const cost = colorIdentityCost(summary);

  return (
    <li ref={ref}>
      <button
        type="button"
        className="deck-picker-row"
        aria-current={picked || undefined}
        onClick={() => onPick(product)}
        disabled={busy}
      >
        <span className="deck-picker-row-text">
          <span className="deck-picker-row-name">{product.name}</span>
          <span className="deck-picker-row-meta">
            {summary?.name ??
              (product.releaseDate ? product.releaseDate.slice(0, 4) : product.code)}
          </span>
        </span>
        {busy ? (
          <span className="spinner" aria-label="Picking that deck" />
        ) : (
          summary &&
          cost && (
            <span
              className="deck-picker-row-colors"
              role="img"
              aria-label={colorIdentityLabel(summary)}
            >
              <ManaCost cost={cost} />
            </span>
          )
        )}
      </button>
    </li>
  );
}
