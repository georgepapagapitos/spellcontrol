import { type JSX, useState } from 'react';
import { COLOR_INFO, colorIdentityWords } from '../../lib/colors';
import { ColorPip } from '../shared/ManaSymbol';
import { DeckColorBalance } from './DeckColorBalance';
import { useCardCarousel, tallyToEntries, type CardTally } from './useCardCarousel';
import { CardGroupSheet } from './CardGroupSheet';
import './DeckColorPanel.css';

/**
 * The deck's colors in one readout: an identity line (the pips and the colors
 * in words, "Mono-white" or "White, blue and black", with the non-land count),
 * then the mana base, where each color's cards stand against the sources that
 * make it (<DeckColorBalance>). Each count opens the list it counts.
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
}): JSX.Element {
  // Two carousels so each drill-down shows an accurate context label: the
  // Production sources vs. the Distribution (colored cards) for a color.
  const sourcesCarousel = useCardCarousel('Mana sources');
  const colorsCarousel = useCardCarousel('Color');

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
    </div>
  );
}
