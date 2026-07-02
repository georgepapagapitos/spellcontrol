import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { getOwnedPrinting } from '@/deck-builder/services/scryfall/client';
import { fetchCommanderData } from '@/deck-builder/services/edhrec/client';
import { useCollectionStore } from '../../store/collection';
import { useDecksStore } from '../../store/decks';
import { useCardThumb } from '../../lib/card-thumbs';
import { toast } from '../../store/toasts';
import {
  extractCommanderCandidates,
  computeReadiness,
  sortCommanderCandidates,
  SPOTLIGHT_TOP_N,
  type ReadinessScore,
} from '../../lib/commander-readiness';
import { ReadinessChip } from './CommanderReadiness';
import type { EnrichedCard } from '../../types';
import './ReadinessSpotlight.css';

/** Below this collection size a readiness % is too noisy to be a useful "what to build" signal. */
const MIN_COLLECTION_SIZE = 20;
/** How many top-readiness picks the strip shows at once. */
const SHOWN_COUNT = 3;
const DISMISS_KEY = 'readiness-spotlight-dismissed-signature';

// ponytail: dismissal is keyed to a signature of the currently-shown names (not
// per-name) — a plain-string localStorage compare. Trivial and still lets a
// genuinely new top pick resurface the strip, since a different pick set is a
// different signature.
function loadDismissedSignature(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

function persistDismissedSignature(sig: string): void {
  try {
    localStorage.setItem(DISMISS_KEY, sig);
  } catch {
    /* ignore storage failures */
  }
}

function SpotlightCard({
  card,
  score,
  selecting,
  disabled,
  onSelect,
}: {
  card: EnrichedCard;
  score: ReadinessScore;
  selecting: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  // Owned rows usually already carry a resolved thumb (imageSmall, from the
  // CDN when the collection was synced) — only hit useCardThumb's CDN lookup
  // when that's missing.
  const resolved = useCardThumb(card.imageSmall ? undefined : card.name, 'small');
  const art = card.imageSmall ?? resolved;
  return (
    <button
      type="button"
      className="readiness-spotlight-card"
      onClick={onSelect}
      disabled={disabled}
    >
      <span className="readiness-spotlight-card-art" aria-hidden>
        {art ? (
          <img src={art} alt="" loading="lazy" />
        ) : (
          <span className="readiness-spotlight-card-art-skeleton" />
        )}
      </span>
      <span className="readiness-spotlight-card-body">
        <span className="readiness-spotlight-card-headline">
          <span className="readiness-spotlight-card-name">
            {selecting ? 'Loading…' : card.name}
          </span>
          <ReadinessChip score={score} />
        </span>
        <span className="readiness-spotlight-card-explainer">{score.explainerLine}</span>
      </span>
    </button>
  );
}

/**
 * "What should I build next" strip above the Decks grid: the top 1-3 owned
 * commanders (that don't already have a deck) ranked by EDHREC-staple
 * readiness. This is the literal "what should I build next" answer nobody
 * else can give — nobody else knows what you physically own.
 *
 * Readiness is fetched lazily after mount (never blocks first paint of the
 * deck grid below). Dismissible; the dismissal is keyed to the current pick
 * signature so it can resurface once the top pick genuinely changes.
 */
export function ReadinessSpotlight() {
  const navigate = useNavigate();
  const decks = useDecksStore((s) => s.decks);
  const collectionCards = useCollectionStore((s) => s.cards);
  const importHistory = useCollectionStore((s) => s.importHistory);

  const [dismissedSig, setDismissedSig] = useState<string | null>(() => loadDismissedSignature());
  const [scores, setScores] = useState<Map<string, ReadinessScore>>(new Map());
  // Key of the candidate set the current `scores` were fetched for — compared
  // against the live candidate key below rather than a separate "ready"
  // boolean that would need a synchronous reset inside the effect.
  const [scoresReadyKey, setScoresReadyKey] = useState<string | null>(null);
  const [selectingName, setSelectingName] = useState<string | null>(null);

  const importRecency = useMemo(
    () => new Map(importHistory.map((h) => [h.id, h.addedAt])),
    [importHistory]
  );

  const ownedCardNames = useMemo(
    () => new Set(collectionCards.map((c) => c.name.toLowerCase())),
    [collectionCards]
  );

  const deckCommanderNames = useMemo(() => {
    const names = new Set<string>();
    for (const d of decks) {
      if (d.commander) names.add(d.commander.name.toLowerCase());
      if (d.partnerCommander) names.add(d.partnerCommander.name.toLowerCase());
    }
    return names;
  }, [decks]);

  // Candidate pool worth checking readiness for: owned commanders without a
  // deck yet, most-recently-added first. Capped at SPOTLIGHT_TOP_N so a large
  // collection doesn't fire dozens of EDHREC fetches for a 3-card strip.
  const candidates = useMemo(() => {
    const eligible = extractCommanderCandidates(collectionCards, importRecency);
    const undecked = eligible.filter((c) => !deckCommanderNames.has(c.name.toLowerCase()));
    return sortCommanderCandidates(undecked, new Map(), 'recentlyAdded', importRecency).slice(
      0,
      SPOTLIGHT_TOP_N
    );
  }, [collectionCards, importRecency, deckCommanderNames]);

  const eligible =
    decks.length > 0 && collectionCards.length >= MIN_COLLECTION_SIZE && candidates.length > 0;
  const candidatesKey = candidates.map((c) => c.name).join('|');

  // Fetch readiness for the candidate pool after mount — this is the network
  // step, kept out of render so it never blocks first paint of the deck grid.
  useEffect(() => {
    if (!eligible) return;
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        candidates.map(async (c): Promise<[string, ReadinessScore]> => {
          try {
            const data = await fetchCommanderData(c.name);
            return [c.name, computeReadiness(data.cardlists.allNonLand, ownedCardNames, c.name)];
          } catch {
            return [c.name, computeReadiness([], ownedCardNames, c.name)];
          }
        })
      );
      if (cancelled) return;
      setScores(new Map(entries));
      setScoresReadyKey(candidatesKey);
    })();
    return () => {
      cancelled = true;
    };
  }, [eligible, candidates, candidatesKey, ownedCardNames]);

  const scoresReady = scoresReadyKey === candidatesKey;

  const picks = useMemo(() => {
    if (!scoresReady) return [];
    return sortCommanderCandidates(candidates, scores, 'readiness')
      .filter((c) => scores.get(c.name)?.available)
      .slice(0, SHOWN_COUNT);
  }, [scoresReady, candidates, scores]);

  const signature = picks.map((c) => c.name).join('|');

  if (!eligible || picks.length === 0 || dismissedSig === signature) return null;

  const handleSelect = async (owned: EnrichedCard) => {
    setSelectingName(owned.name);
    try {
      const card = await getOwnedPrinting(owned.scryfallId, owned.name);
      navigate('/decks/new', {
        state: {
          prefill: {
            commander: card,
            themes: [],
            targetBracket: 'all',
            landCount: 37,
            collectionMode: false,
          },
        },
      });
    } catch {
      toast.show({ message: `Couldn't load ${owned.name}`, tone: 'error' });
    } finally {
      setSelectingName(null);
    }
  };

  const handleDismiss = () => {
    persistDismissedSignature(signature);
    setDismissedSig(signature);
  };

  return (
    <section className="readiness-spotlight" aria-label="Commander readiness spotlight">
      <div className="readiness-spotlight-header">
        <div className="readiness-spotlight-header-text">
          <p className="readiness-spotlight-eyebrow">Build another</p>
          <p className="readiness-spotlight-hint">
            You already own the staples — here&rsquo;s what&rsquo;s closest to done.
          </p>
        </div>
        <button
          type="button"
          className="readiness-spotlight-dismiss"
          onClick={handleDismiss}
          aria-label="Dismiss readiness spotlight"
        >
          <X width={16} height={16} strokeWidth={1.8} aria-hidden />
        </button>
      </div>
      <div className="readiness-spotlight-list">
        {picks.map((c) => {
          const score = scores.get(c.name);
          if (!score) return null;
          return (
            <SpotlightCard
              key={c.copyId}
              card={c}
              score={score}
              selecting={selectingName === c.name}
              disabled={selectingName !== null}
              onSelect={() => void handleSelect(c)}
            />
          );
        })}
      </div>
    </section>
  );
}
