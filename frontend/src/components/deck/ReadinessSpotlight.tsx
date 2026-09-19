import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Sparkles, X } from 'lucide-react';
import { getOwnedPrinting } from '@/deck-builder/services/scryfall/client';
import { fetchCommanderData } from '@/deck-builder/services/edhrec/client';
import { useCollectionStore } from '../../store/collection';
import { useDecksStore } from '../../store/decks';
import { useCardThumb } from '../../lib/card-thumbs';
import { useEscapeKey } from '../../lib/use-escape-key';
import { useLockBodyScroll } from '../../lib/use-lock-body-scroll';
import { useSheetExit } from '../../lib/use-sheet-exit';
import { toast } from '../../store/toasts';
import {
  extractCommanderCandidates,
  computeReadiness,
  sortCommanderCandidates,
  MIN_COLLECTION_SIZE,
  SPOTLIGHT_TOP_N,
  type ReadinessScore,
} from '../../lib/commander-readiness';
import { ReadinessChip } from './CommanderReadiness';
import type { EnrichedCard } from '../../types';
import './ReadinessSpotlight.css';

/** How many top-readiness picks the strip/sheet shows at once. */
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
 * The full pick list, in the same `card-picker` bottom sheet (mobile) / centered
 * modal (≥1024px) shell `BetweenYourDecksSheet` uses — see that component for
 * the containment/animation rationale (no portal, mirrored slide-out).
 */
function ReadinessSpotlightSheet({
  picks,
  scores,
  selectingName,
  onSelect,
  onClose,
}: {
  picks: EnrichedCard[];
  scores: Map<string, ReadinessScore>;
  selectingName: string | null;
  onSelect: (card: EnrichedCard) => void;
  onClose: () => void;
}) {
  useLockBodyScroll();
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'binder-sheet-slide-out');
  const dismiss = useCallback(() => {
    if (window.matchMedia('(min-width: 1024px)').matches) onClose();
    else beginClose();
  }, [beginClose, onClose]);
  useEscapeKey(dismiss);

  return (
    <div
      className="card-picker-root readiness-spotlight-sheet-root"
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) dismiss();
      }}
      role="presentation"
    >
      <div
        className={`card-picker-sheet readiness-spotlight-sheet${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Build another"
        onAnimationEnd={onAnimationEnd}
      >
        <div className="card-picker-handle" aria-hidden />
        <header className="readiness-spotlight-sheet-head">
          <div className="readiness-spotlight-sheet-titles">
            <h2 className="readiness-spotlight-sheet-title">Build another</h2>
            <p className="readiness-spotlight-sheet-sub">
              You already own the staples. Closest to done shows first.
            </p>
          </div>
          <button
            type="button"
            className="readiness-spotlight-sheet-close"
            onClick={dismiss}
            aria-label="Close"
          >
            <X width={18} height={18} strokeWidth={2} aria-hidden />
          </button>
        </header>
        <div className="readiness-spotlight-list readiness-spotlight-sheet-body">
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
                onSelect={() => onSelect(c)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** One-row summary: icon, label, a count pill, and (space permitting) a teaser
 *  of the top pick — mirrors `BetweenYourDecksStrip` (STYLE_GUIDE "Index-page
 *  insight strips"). Rendered as soon as the candidate pool is known
 *  (synchronously, before the readiness fetch resolves) so the strip reserves
 *  its own height from first paint and never pops a card block in under the
 *  deck grid mid-load. */
function ReadinessSpotlightStrip({
  ready,
  picks,
  scores,
  onOpen,
  onDismiss,
}: {
  ready: boolean;
  picks: EnrichedCard[];
  scores: Map<string, ReadinessScore>;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const top = picks[0];
  const topScore = top ? scores.get(top.name) : undefined;
  return (
    <div className="readiness-spotlight-strip">
      <button
        type="button"
        className="readiness-spotlight-strip-main"
        onClick={onOpen}
        disabled={!ready}
        aria-haspopup={ready ? 'dialog' : undefined}
      >
        <Sparkles className="readiness-spotlight-strip-icon" aria-hidden width={16} height={16} />
        <span className="readiness-spotlight-strip-label">Build another</span>
        {ready ? (
          <>
            <span className="readiness-spotlight-strip-count">
              {picks.length} pick{picks.length === 1 ? '' : 's'}
            </span>
            {top && topScore && (
              <span className="readiness-spotlight-strip-teaser">
                {top.name}
                <span className="readiness-spotlight-strip-teaser-sep" aria-hidden>
                  ·
                </span>
                {topScore.explainerLine}
              </span>
            )}
            <ChevronRight
              className="readiness-spotlight-strip-chevron"
              aria-hidden
              width={16}
              height={16}
            />
          </>
        ) : (
          <span className="readiness-spotlight-strip-teaser is-loading">
            Checking your collection…
          </span>
        )}
      </button>
      {ready && (
        <button
          type="button"
          className="readiness-spotlight-strip-dismiss"
          onClick={onDismiss}
          aria-label={`Hide ${picks.length} build suggestion${picks.length === 1 ? '' : 's'}`}
        >
          <X width={16} height={16} strokeWidth={2} aria-hidden />
        </button>
      )}
    </div>
  );
}

/**
 * "What should I build next" strip above the Decks grid: the top 1-3 owned
 * commanders (that don't already have a deck) ranked by EDHREC-staple
 * readiness. This is the literal "what should I build next" answer nobody
 * else can give — nobody else knows what you physically own.
 *
 * Collapses to a one-row strip that opens the pick list in a sheet on tap
 * (STYLE_GUIDE "Index-page insight strips") — the strip mounts as soon as the
 * candidate pool is known, before the EDHREC readiness fetch resolves, so it
 * reserves its own height and never pops a multi-card block under the deck
 * grid mid-load. Dismissible; the dismissal is keyed to the current pick
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
  const [open, setOpen] = useState(false);

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
            return [c.name, computeReadiness(data.cardlists.allNonLand, ownedCardNames)];
          } catch {
            return [c.name, computeReadiness([], ownedCardNames)];
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

  // Render-phase adjustment: a sheet left open across a recompute that empties
  // the pick list (e.g. a fresh candidate batch resolves to nothing) must not
  // linger open over an empty list — reset before commit rather than in an effect.
  if (open && scoresReady && picks.length === 0) setOpen(false);

  if (!eligible) return null;
  if (scoresReady && (picks.length === 0 || dismissedSig === signature)) return null;

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
      toast.show({ message: `Couldn't load ${owned.name}. Try again.`, tone: 'error' });
    } finally {
      setSelectingName(null);
    }
  };

  const handleDismiss = () => {
    persistDismissedSignature(signature);
    setDismissedSig(signature);
    setOpen(false);
  };

  return (
    <>
      <ReadinessSpotlightStrip
        ready={scoresReady}
        picks={picks}
        scores={scores}
        onOpen={() => setOpen(true)}
        onDismiss={handleDismiss}
      />
      {open && scoresReady && picks.length > 0 && (
        <ReadinessSpotlightSheet
          picks={picks}
          scores={scores}
          selectingName={selectingName}
          onSelect={(c) => void handleSelect(c)}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
