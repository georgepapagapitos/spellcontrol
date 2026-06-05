import './ImproveLane.css';
import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { DeckCardRow } from './DeckCardRow';
import { DeckHoverPeek } from './DeckHoverPeek';
import { useDeckHoverPeek } from './use-deck-hover-peek';
import { useCardCarousel } from './useCardCarousel';
import {
  fromGapCard,
  fromOptimizeCard,
  fromSynergySuggestion,
  fromSubstituteRow,
  mergeImprove,
  type Change,
  type ChangeOwnership,
} from '@/lib/deck-change';
import type { GapAnalysisCard } from '@/deck-builder/types';
import type { OptimizeSwaps } from '@/deck-builder/services/deckBuilder/deckAnalyzer';
import type { SynergySuggestion } from '@/deck-builder/services/synergy/suggest';
import type { SubstituteRow } from '@/deck-builder/services/deckBuilder/substituteFinder';

const OWNED_ONLY_KEY = 'spellcontrol-improve-owned-only';

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

export interface ImproveLaneProps {
  /** EDHREC missing-staples (deck.gapAnalysis) — the prescriptive gap source. */
  gaps: GapAnalysisCard[];
  /** Optimizer pools: additions feed the list, removals feed "Consider cutting". */
  optimize?: OptimizeSwaps;
  /** Off-meta synergy picks (deck.synergyAnalysis.suggestions). */
  synergy: SynergySuggestion[];
  /** Owned role-substitutes for unowned staples — injected only in Owned-only mode. */
  substitutes: SubstituteRow[];
  /** Allocation-aware ownership for a card name, re-derived live (never stale). */
  resolveOwnership: (name: string) => ChangeOwnership;
  /** Add a card by name (shared add path). */
  onAdd: (cardName: string) => void | Promise<void>;
  /** Cut an in-deck card by name (shared cut path). */
  onCut: (cardName: string) => void | Promise<void>;
  /** Names with an action in flight (disables their button). */
  busyNames?: Set<string>;
  /** Commander name, for the inclusion-line wording. */
  commanderName?: string;
  /** The EDHREC theme-browser (DeckAnalysisPanel), shown behind an expander. */
  browser?: ReactNode;
}

/**
 * The unified Tune "Improve the deck" engine. Merges every prescriptive
 * add-source — EDHREC gap staples, optimizer additions, off-meta synergy picks,
 * and (in Owned-only mode) owned role-substitutes — into one deduped, owned-first
 * list rendered through the shared `<DeckCardRow>`. Optimizer removals live in a
 * collapsed "Consider cutting" section; the richer EDHREC theme-browser stays
 * available behind a "Browse all EDHREC suggestions" expander. Replaces the old
 * Fill-the-gaps / Upgrade-power / Build-from-collection lanes (their data
 * generators still feed this; only their bespoke rendering retired).
 */
export function ImproveLane({
  gaps,
  optimize,
  synergy,
  substitutes,
  resolveOwnership,
  onAdd,
  onCut,
  busyNames,
  commanderName,
  browser,
}: ImproveLaneProps): JSX.Element {
  const busy = busyNames ?? new Set<string>();
  const [ownedOnly, setOwnedOnly] = useState<boolean>(readOwnedOnly);
  const carousel = useCardCarousel('Improve the deck');
  // Cursor-anchored hover-peek (the shared default) — floats the card beside the
  // pointer on any hover-capable viewport, consistent with the deck list. Touch
  // still uses tap→carousel (capability-gated). Dismisses when the pointer leaves
  // a thumbnail (the only `data-peek-name` element on a row).
  const hoverPeek = useDeckHoverPeek();

  // Every prescriptive add-source → a normalized Change with live ownership,
  // then merged (dedupe by name, keep the higher-signal row) + owned-first.
  const all = useMemo(
    () =>
      mergeImprove([
        ...gaps.map((g) => fromGapCard(g, resolveOwnership(g.name))),
        ...(optimize?.additions ?? []).map((o) =>
          fromOptimizeCard(o, 'add', resolveOwnership(o.name))
        ),
        ...synergy.map((s) => fromSynergySuggestion(s, resolveOwnership(s.cardName))),
      ]),
    [gaps, optimize, synergy, resolveOwnership]
  );

  // Owned-only view: keep the owned candidates, then fold in owned substitutes
  // (an owned card that fills an unowned staple's role) so the zero-spend path
  // surfaces both. Re-merged so a substitute that duplicates an owned add collapses.
  const ownedView = useMemo(
    () =>
      mergeImprove([
        ...all.filter((c) => c.ownership === 'owned'),
        ...substitutes.map(fromSubstituteRow),
      ]),
    [all, substitutes]
  );

  const shown = ownedOnly ? ownedView : all;

  const cuts = useMemo(
    () => (optimize?.removals ?? []).map((o) => fromOptimizeCard(o, 'cut')),
    [optimize]
  );

  // Carousel entries span everything previewable, so swiping works across the
  // whole lane regardless of which row was tapped.
  const previewEntries = useMemo(
    () =>
      [...shown, ...cuts].map((c) => ({
        name: c.name,
        label:
          typeof c.inclusion === 'number' ? `In ${Math.round(c.inclusion)}% of decks` : 'Off-meta',
      })),
    [shown, cuts]
  );

  const toggleOwned = () => {
    setOwnedOnly((v) => {
      writeOwnedOnly(!v);
      return !v;
    });
  };

  const renderRow = (change: Change, act: (name: string) => void | Promise<void>) => (
    <DeckCardRow
      key={change.id}
      change={change}
      commanderName={commanderName}
      peekName={change.name}
      onAct={() => void act(change.name)}
      acting={busy.has(change.name)}
      onPreview={() => void carousel.open(previewEntries, change.name)}
    />
  );

  return (
    <section className="improve-lane" aria-label="Improve the deck" {...hoverPeek.listHandlers}>
      <div className="improve-lane-controls">
        <label className="field-checkbox improve-owned-toggle">
          <input type="checkbox" checked={ownedOnly} onChange={toggleOwned} />
          <span>Owned only</span>
        </label>
        <span className="improve-lane-count">
          {shown.length} {shown.length === 1 ? 'card' : 'cards'}
        </span>
      </div>

      {shown.length > 0 ? (
        <ul className="improve-lane-list">{shown.map((c) => renderRow(c, onAdd))}</ul>
      ) : (
        <p className="improve-lane-empty">
          {ownedOnly
            ? 'No owned improvements right now — turn off Owned only to see cards to acquire.'
            : 'No suggested changes — your deck is well-covered.'}
        </p>
      )}

      {cuts.length > 0 && (
        <details className="improve-lane-section">
          <summary>
            <ChevronDown width={14} height={14} aria-hidden />
            Consider cutting ({cuts.length})
          </summary>
          <ul className="improve-lane-list">{cuts.map((c) => renderRow(c, onCut))}</ul>
        </details>
      )}

      {browser && (
        <details className="improve-lane-section">
          <summary>
            <ChevronDown width={14} height={14} aria-hidden />
            Browse all EDHREC suggestions
          </summary>
          <div className="improve-lane-browser">{browser}</div>
        </details>
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
  );
}
