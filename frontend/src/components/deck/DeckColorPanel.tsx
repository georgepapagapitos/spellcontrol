import { type JSX, useState } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';
import { colorIdentityWords } from '@/lib/cards/colors';
import { costChangingCommander } from '@/lib/deck-analysis/castability';
import { COLOR_INFO } from '@spellcontrol/binder-routing';
import { ColorPip } from '../shared/ManaSymbol';
import { DeckColorBalance } from './DeckColorBalance';
import { DeckCastability } from './DeckCastability';
import { useCastability } from './use-castability';
import { useCardCarousel, tallyToEntries } from './useCardCarousel';
import { type CardTally } from '@/lib/deck-analysis/card-tally';
import { CardGroupSheet } from './CardGroupSheet';
import './DeckColorPanel.css';

const NO_CARDS: readonly ScryfallCard[] = [];

/**
 * The deck's colors in one readout: an identity line (the pips and the colors
 * in words, "Mono-white" or "White, blue and black", with the non-land count),
 * then the mana base, where each color's cards stand against the sources that
 * make it (<DeckColorBalance>), then which spells miss their colors on curve
 * (<DeckCastability>). Each count opens the list it counts.
 *
 * The share-of-deck donut that used to lead here answered "what share of the
 * deck is blue?", which nobody asks; "can I cast my spells?" is the question,
 * and the mana base rows answer it with the same per-color counts.
 */

const WUBRG = ['W', 'U', 'B', 'R', 'G'];

export function DeckColorPanel({
  colorDist,
  manaProduction,
  cardsByColor,
  manaCurve,
  landUpgradeCount,
  onReanalyzeLands,
  simCommanders = NO_CARDS,
  simLibrary = NO_CARDS,
  readOnly = false,
}: {
  colorDist: { counts: Record<string, number>; total: number };
  manaProduction: {
    counts: Record<string, number>;
    total: number;
    sourcesByColor?: Record<string, CardTally[]>;
  };
  /** Per-color card lists for the Distribution donut drill-down (non-land cards
   *  by color identity). */
  cardsByColor?: Record<string, CardTally[]>;
  /** Nonland mana curve (CMC → count) → pacing for the Mana base shortfall bar. */
  manaCurve?: Record<number, number>;
  /** Count of stronger owned lands found → drives the Mana base "Re-analyze
   *  lands" CTA (hidden at 0). */
  landUpgradeCount?: number;
  /** Deep-link into the Coach tab's Lands lane. */
  onReanalyzeLands?: () => void;
  /** The command zone, mana-backfilled, for the castability simulation. Memoized. */
  simCommanders?: readonly ScryfallCard[];
  /** The rest of the deck, one entry per copy, mana-backfilled. Memoized. */
  simLibrary?: readonly ScryfallCard[];
  /** The shared deck page: the castability advice describes the deck instead. */
  readOnly?: boolean;
}): JSX.Element {
  // Two carousels so each drill-down shows an accurate context label: the
  // Production sources vs. the Distribution (colored cards) for a color.
  const sourcesCarousel = useCardCarousel('Mana sources');
  const colorsCarousel = useCardCarousel('Color');
  const castCarousel = useCardCarousel('Castable on curve');
  const castability = useCastability(simCommanders, simLibrary);

  // Tapping a color opens the grouped overview sheet (grid/list) first, then a
  // tapped card hands off to that drill-down's carousel for the detail read.
  const [groupSheet, setGroupSheet] = useState<{
    title: string;
    tally: CardTally[];
    carousel: ReturnType<typeof useCardCarousel>;
  } | null>(null);

  const openGroup = (
    carousel: ReturnType<typeof useCardCarousel>,
    tally: CardTally[] | undefined,
    title: string
  ) => {
    if (!tally || tally.length === 0) return;
    const sorted = [...tally].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    setGroupSheet({ title, tally: sorted, carousel });
  };

  const pickFromGroup = (picked: CardTally) => {
    if (!groupSheet) return;
    void groupSheet.carousel.open(tallyToEntries(groupSheet.tally), picked.name);
  };

  // The castability rows page through each other in the preview, in list order.
  const showCastCard = (name: string) => {
    if (!castability) return;
    const deck = [...simCommanders, ...simLibrary];
    const tally = [...castability.under, ...castability.atBar].map((row) => ({
      name: row.name,
      count: 1,
      card: deck.find((c) => c.name === row.name),
    }));
    void castCarousel.open(tallyToEntries(tally), name);
  };

  const colorLabel = (k: string) => COLOR_INFO[k]?.label ?? k;
  // The deck's colors: every WUBRG color some non-land card needs.
  const identity = WUBRG.filter((k) => (colorDist.counts[k] ?? 0) > 0);

  return (
    <div className="deck-color-panel">
      {colorDist.total > 0 && (
        <p className="deck-color-identity">
          {identity.length > 0 && (
            <span className="deck-color-identity-pips" aria-hidden="true">
              {identity.map((k) => (
                <ColorPip key={k} color={k} />
              ))}
            </span>
          )}
          <strong className="deck-color-identity-words">{colorIdentityWords(identity)}</strong>
          <span className="deck-color-identity-count">
            {colorDist.total} non-land {colorDist.total === 1 ? 'card' : 'cards'}
          </span>
        </p>
      )}

      <DeckColorBalance
        colorRequirements={colorDist.counts}
        colorProduction={manaProduction.counts}
        sourcesByColor={manaProduction.sourcesByColor}
        cardsByColor={cardsByColor}
        onShowSources={(k) =>
          openGroup(sourcesCarousel, manaProduction.sourcesByColor?.[k], `${colorLabel(k)} sources`)
        }
        onShowCards={(k) => openGroup(colorsCarousel, cardsByColor?.[k], `${colorLabel(k)} cards`)}
        manaCurve={manaCurve}
        landUpgradeCount={landUpgradeCount}
        onReanalyzeLands={onReanalyzeLands}
      />

      {castability && (
        <DeckCastability
          report={castability}
          owner={!readOnly}
          costChangedBy={costChangingCommander(simCommanders)}
          onShowCard={showCastCard}
        />
      )}

      {groupSheet && (
        <CardGroupSheet
          title={groupSheet.title}
          tally={groupSheet.tally}
          onPick={pickFromGroup}
          onClose={() => setGroupSheet(null)}
        />
      )}
      {sourcesCarousel.preview}
      {colorsCarousel.preview}
      {castCarousel.preview}
    </div>
  );
}
