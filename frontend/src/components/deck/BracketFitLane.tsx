import './BracketFitLane.css';
import { forwardRef, useMemo, useState } from 'react';
import { Target, AlertTriangle } from 'lucide-react';
import { DeckCardRow } from './DeckCardRow';
import { DeckHoverPeek } from './DeckHoverPeek';
import { VerdictBadge } from './VerdictBadge';
import { CollapsibleLane, type CollapsibleLaneHandle } from './CollapsibleLane';
import { useDeckHoverPeek } from './use-deck-hover-peek';
import { useCardCarousel } from './useCardCarousel';
import { fromBracketFitMove, type Change, type ChangeOwnership } from '@/lib/deck-change';
import type { BracketFitPlan } from '@/deck-builder/services/deckBuilder/bracketFit';

const OWNED_ONLY_KEY = 'spellcontrol-bracket-fit-owned-only';

/** Full-size card art for the desktop hover-peek — the Scryfall named-image CDN
 *  redirect (no JS API call), so the peek is crisp regardless of a row's thumb. */
function peekImage(name: string): string {
  return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}&format=image&version=normal`;
}

function readOwnedOnly(): boolean {
  try {
    return window.localStorage.getItem(OWNED_ONLY_KEY) === '1';
  } catch {
    return false;
  }
}

function writeOwnedOnly(v: boolean): void {
  try {
    window.localStorage.setItem(OWNED_ONLY_KEY, v ? '1' : '0');
  } catch {
    /* storage unavailable — non-fatal */
  }
}

export interface BracketFitLaneProps {
  /** The persisted Bracket Fit plan (deck.bracketFit). */
  plan: BracketFitPlan;
  /** Commander name, for the inclusion-line wording. */
  commanderName?: string;
  /** Allocation-aware ownership for a card name, re-derived live (never stale). */
  resolveOwnership: (name: string) => ChangeOwnership;
  /** Add a card by name (shared add path — size-aware). */
  onAdd: (cardName: string) => void | Promise<void>;
  /** Cut an in-deck card by name (shared cut path). */
  onCut: (cardName: string) => void | Promise<void>;
  /** Swap: cut `outName`, add `inName` (1-for-1, keeps the deck legal). */
  onSwap: (outName: string, inName: string) => void | Promise<void>;
  /** Names with an action in flight (disables their button + spins it). */
  busyNames?: Set<string>;
}

/**
 * The Power-tab "Bracket Fit" coaching lane. When the user sets a TARGET bracket
 * that differs from the deck's estimate, this turns the descriptive
 * BracketVerdictStrip into a PRESCRIPTIVE list of concrete card moves:
 *
 *   - too-strong → CUT rows (each an optional same-role lower-power SWAP).
 *   - too-weak   → ADD rows (power the deck up toward the target).
 *   - aligned    → no lane body; a small "Aligned" confirmation chip.
 *
 * Every row renders through the shared `<DeckCardRow>` over the Change model (so
 * this and the card-preview can never disagree); the lane chrome is the shared
 * `<CollapsibleLane>`. Carousel + desktop hover-peek mirror the Improve lane.
 *
 * Forwards a {@link CollapsibleLaneHandle} ref so a future hero deep-link can
 * `reveal()` the lane (registered in DeckAnalysisView's laneRefs). The aligned
 * state renders no CollapsibleLane, so the ref is inert there (no moves to show).
 */
export const BracketFitLane = forwardRef<CollapsibleLaneHandle, BracketFitLaneProps>(
  function BracketFitLane(
    { plan, commanderName, resolveOwnership, onAdd, onCut, onSwap, busyNames },
    ref
  ): JSX.Element {
    const busy = busyNames ?? new Set<string>();
    const carousel = useCardCarousel('Bracket Fit');
    // Cursor-anchored hover-peek (the shared default) — consistent with the deck
    // list and the Improve lane. No-op on touch/native (capability-gated).
    const hoverPeek = useDeckHoverPeek();
    const [ownedOnly, setOwnedOnly] = useState<boolean>(readOwnedOnly);

    const isUpshift = plan.direction === 'too-weak';

    // Adapt every move into a Change with live ownership (re-derived each render).
    // For a swap, ownership describes the replacement (Change.name = the card
    // coming in); a cut is ownership-blind (resolveOwnership not called).
    const changes = useMemo<Change[]>(
      () =>
        plan.moves.map((m) => {
          const ownershipName = m.type === 'swap' ? (m.inName ?? m.name) : m.name;
          const ownership = m.type === 'cut' ? undefined : resolveOwnership(ownershipName);
          return fromBracketFitMove(m, ownership);
        }),
      [plan.moves, resolveOwnership]
    );

    // Owned-only is an UPSHIFT-only filter: powering up draws Game Changers and
    // staples you likely don't own, so the toggle restricts the suggestions to
    // power cards already in your collection (ownership describes the card coming
    // IN, for both adds and full-deck swaps). Downshift cuts/replacements aren't
    // filtered — you cut an offender regardless of what you own.
    const ownedFilterActive = isUpshift && ownedOnly;
    const shown = useMemo(
      () => (ownedFilterActive ? changes.filter((c) => c.ownership === 'owned') : changes),
      [changes, ownedFilterActive]
    );

    // Carousel spans every previewable card so swiping works across the lane.
    // For a swap that's BOTH sides — the card coming in (Change.name) AND the
    // offender being cut (Change.inName) — so tapping either thumbnail inspects
    // that card and you can swipe between them. Deduped (a card can recur).
    const previewEntries = useMemo(() => {
      const seen = new Set<string>();
      const entries: { name: string; label: string }[] = [];
      const push = (name: string | undefined, label: string) => {
        if (!name || seen.has(name)) return;
        seen.add(name);
        entries.push({ name, label });
      };
      for (const c of shown) {
        push(
          c.name,
          typeof c.inclusion === 'number'
            ? `In ${Math.round(c.inclusion)}% of decks`
            : 'Bracket Fit'
        );
        if (c.type === 'swap') push(c.inName, 'Being cut');
      }
      return entries;
    }, [shown]);

    const toggleOwned = () => {
      setOwnedOnly((v) => {
        writeOwnedOnly(!v);
        return !v;
      });
    };

    // Dispatch a row's action to the right shared handler by Change type. For a
    // swap, Change.name is the replacement (add) and Change.inName is the card to
    // cut — the page resolves the slot from the cut name.
    const actFor = (change: Change): (() => void | Promise<void>) => {
      if (change.type === 'add') return () => onAdd(change.name);
      if (change.type === 'cut') return () => onCut(change.name);
      return () => onSwap(change.inName ?? '', change.name);
    };

    // The card whose busy state gates a row:
    //   - add → the card being added (Change.name).
    //   - cut → the card being cut (Change.name).
    //   - swap → the card being CUT (Change.inName). The page tracks an in-flight
    //     swap by its cut name (matched to the slot it removes), so gating on the
    //     replacement (Change.name) would never disable the row — leaving a
    //     double-submit window. Fall back to Change.name if inName is missing.
    const busyKeyFor = (change: Change): string =>
      change.type === 'swap' ? (change.inName ?? change.name) : change.name;

    // ── Aligned: no lane body, just a confirmation chip. ──
    if (plan.direction === 'aligned') {
      return (
        <div className="bracket-fit-aligned">
          <VerdictBadge
            tone="success"
            label="Aligned"
            reason={`Deck plays at Bracket ${plan.targetBracket} — nothing to change.`}
          />
        </div>
      );
    }

    // Headline tracks the VISIBLE list. With Owned only on, the engine's summary
    // ("Swap in 10 cards…") would over-count, so recompute from `shown`. The verb
    // follows the move shape (full-deck upshift = swaps, otherwise adds).
    const upshiftVerb = changes.some((c) => c.type === 'swap') ? 'Swap in' : 'Add';
    let headline = plan.summary;
    if (ownedFilterActive) {
      headline =
        shown.length === 0
          ? 'No owned power-ups available.'
          : `${upshiftVerb} ${shown.length} owned card${shown.length === 1 ? '' : 's'}.`;
    }

    // Owned only hides the cards you'd need to acquire, so the owned subset may
    // not be enough to actually reach the target — say so rather than implying it.
    const ownedShortfall = ownedFilterActive && shown.length > 0 && shown.length < changes.length;
    const showCeilingNote = isUpshift && plan.targetBracket === 5 && plan.detectedBracket >= 4;

    return (
      <CollapsibleLane
        ref={ref}
        title={isUpshift ? 'Power Up' : 'Bracket Fit'}
        icon={<Target width={16} height={16} aria-hidden />}
        summary={
          <span className="bracket-fit-summary-chip">
            {plan.moves.length} {plan.moves.length === 1 ? 'move' : 'moves'}
          </span>
        }
        defaultCollapsed={false}
        storageKey="spellcontrol-bracket-fit"
      >
        <section className="bracket-fit-lane" aria-label="Bracket Fit" {...hoverPeek.listHandlers}>
          <p className="bracket-fit-headline">{headline}</p>

          {showCeilingNote && (
            <p className="bracket-fit-ceiling-note">
              Already at the build ceiling — Bracket 5 is mindset and metagame, not more cards.
              Showing combo-completion opportunities below.
            </p>
          )}

          {plan.offlineDegraded && (
            <p className="bracket-fit-offline-note">
              Connect to EDHREC for replacement and add suggestions — cuts based on card type are
              still shown.
            </p>
          )}

          {!plan.achievable && plan.note && (
            <p className="bracket-fit-unachievable-note">{plan.note}</p>
          )}

          {isUpshift && changes.length > 0 && (
            <div className="bracket-fit-controls">
              <button
                type="button"
                className={`bracket-fit-filter${ownedOnly ? ' is-active' : ''}`}
                aria-pressed={ownedOnly}
                onClick={toggleOwned}
              >
                Owned only
              </button>
              <span className="bracket-fit-count">
                {shown.length} {shown.length === 1 ? 'card' : 'cards'}
              </span>
            </div>
          )}

          {ownedShortfall && (
            <p className="bracket-fit-owned-note">
              <AlertTriangle className="bracket-fit-owned-note-icon" aria-hidden />
              <span>
                Owned cards alone may not reach Bracket {plan.targetBracket} — turn off Owned only
                to include cards to acquire.
              </span>
            </p>
          )}

          {shown.length > 0 ? (
            <ul className="bracket-fit-list">
              {shown.map((change) => {
                const act = actFor(change);
                return (
                  <DeckCardRow
                    key={change.id}
                    change={change}
                    commanderName={commanderName}
                    peekName={change.name}
                    onAct={() => void act()}
                    acting={busy.has(busyKeyFor(change))}
                    onPreview={() => void carousel.open(previewEntries, change.name)}
                    onPreviewOut={
                      change.inName
                        ? () => void carousel.open(previewEntries, change.inName as string)
                        : undefined
                    }
                  />
                );
              })}
            </ul>
          ) : ownedFilterActive && changes.length > 0 ? (
            <p className="bracket-fit-empty">
              No owned power-ups right now — turn off Owned only to see cards to acquire.
            </p>
          ) : (
            !plan.offlineDegraded && (
              <p className="bracket-fit-empty">
                No concrete moves available — the gap is small enough that a manual tweak will do.
              </p>
            )
          )}

          {hoverPeek.peek && (
            <DeckHoverPeek
              imageUrl={peekImage(hoverPeek.peek.name)}
              left={hoverPeek.peek.left}
              top={hoverPeek.peek.top}
              width={hoverPeek.peek.width}
            />
          )}

          {carousel.preview}
        </section>
      </CollapsibleLane>
    );
  }
);
