import { useCallback, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import './GapAnalysisPanel.css';
import type { GapAnalysisCard } from '@/deck-builder/types';
import { getCardByName } from '@/deck-builder/services/scryfall/client';
import { scryfallToEnrichedCard } from '@/lib/scryfall-to-enriched';
import type { EnrichedCard } from '@/types';
import { CardPreview } from '@/components/CardPreview';

const MAX_SHOWN = 18;

/** Scryfall named-card image endpoint — a CDN-cached redirect with no JS API
 *  call. Used when EDHREC didn't carry an `imageUrl` through to the gap card. */
function fallbackThumb(name: string): string {
  return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(
    name
  )}&format=image&version=normal`;
}

function thumbFor(card: GapAnalysisCard): string {
  return card.imageUrl || fallbackThumb(card.name);
}

export function GapAnalysisPanel({
  cards,
  ownedNames,
  commanderName,
}: {
  cards: GapAnalysisCard[];
  /** Owned-card names so rows can flag what the user already has. */
  ownedNames?: Set<string>;
  /** When present, the inclusion line reads "In X% of {commanderName} decks". */
  commanderName?: string;
}): JSX.Element | null {
  const [previewCards, setPreviewCards] = useState<EnrichedCard[] | null>(null);
  const [previewLabels, setPreviewLabels] = useState<string[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);

  const shown = cards.slice(0, MAX_SHOWN);

  /** Open the carousel over the full shown list, starting at the tapped card.
   *  Cards are fetched from Scryfall on demand and converted to EnrichedCard;
   *  any that fail to resolve are skipped so the carousel never shows a broken
   *  slot. Mirrors DeckAnalysisPanel's openCarousel. */
  const openCarousel = useCallback(
    async (tappedIndex: number) => {
      const tappedName = shown[tappedIndex]?.name;
      const resolved: EnrichedCard[] = [];
      const labels: string[] = [];
      for (const gap of shown) {
        let card: EnrichedCard | null = null;
        try {
          const scry = await getCardByName(gap.name);
          if (scry) card = scryfallToEnrichedCard(scry);
        } catch {
          /* skip — leaves the slot out of the carousel */
        }
        if (!card) continue;
        resolved.push(card);
        labels.push(gap.inclusion > 0 ? `In ${Math.round(gap.inclusion)}% of decks` : 'Suggestion');
      }
      if (resolved.length === 0) return;
      const idx = resolved.findIndex((c) => c.name.toLowerCase() === tappedName?.toLowerCase());
      setPreviewCards(resolved);
      setPreviewLabels(labels);
      setPreviewIndex(idx >= 0 ? idx : 0);
    },
    [shown]
  );

  if (cards.length === 0) return null;

  const overflow = cards.length - shown.length;

  return (
    <div className="deck-gap">
      <ul className="deck-analysis-suggest-list" aria-label="Cards to consider">
        {shown.map((card, idx) => {
          const owned = card.isOwned || ownedNames?.has(card.name) || false;
          const inclusionText =
            commanderName != null
              ? `In ${Math.round(card.inclusion)}% of ${commanderName} decks`
              : `In ${Math.round(card.inclusion)}% of decks`;
          return (
            <li key={card.name} className="deck-analysis-suggest-row">
              <button
                type="button"
                className="deck-analysis-suggest-art"
                onClick={() => void openCarousel(idx)}
                aria-label={`Preview ${card.name}`}
              >
                <img src={thumbFor(card)} alt={card.name} loading="lazy" decoding="async" />
              </button>
              <button
                type="button"
                className="deck-analysis-suggest-body"
                onClick={() => void openCarousel(idx)}
                aria-label={`Preview ${card.name}`}
              >
                <div className="deck-analysis-suggest-title-row">
                  <span className="deck-analysis-suggest-name" title={card.name}>
                    {card.name}
                  </span>
                  {card.roleLabel && (
                    <span className="deck-analysis-suggest-role">{card.roleLabel}</span>
                  )}
                  {owned && (
                    <span
                      className="deck-analysis-suggest-owned"
                      title="Already in your collection"
                    >
                      Owned
                    </span>
                  )}
                </div>
                <p className="deck-analysis-suggest-meta">
                  <span title="EDHREC inclusion rate">{inclusionText}</span>
                  {card.price && <span className="deck-gap-price"> · ${card.price}</span>}
                </p>
              </button>
            </li>
          );
        })}
        {overflow > 0 && <li className="deck-gap-overflow">+{overflow} more</li>}
      </ul>

      <InclusionDisclosure commanderName={commanderName} />

      {previewCards && previewCards.length > 0 && (
        <CardPreview
          source="suggestion"
          showRole
          cards={previewCards}
          index={previewIndex}
          binderName="Cards to consider"
          sectionLabels={previewLabels}
          pageNumbers={previewCards.map(() => 0)}
          totalPages={1}
          onIndexChange={setPreviewIndex}
          onClose={() => setPreviewCards(null)}
        />
      )}
    </div>
  );
}

/** Collapsible "What's this?" key explaining the inclusion %. Mirrors the
 *  RoleBadgeLegend disclosure pattern (button aria-expanded + chevron). */
function InclusionDisclosure({ commanderName }: { commanderName?: string }) {
  const [open, setOpen] = useState(false);
  const subject = commanderName != null ? `${commanderName} decks` : 'decks for this commander';
  return (
    <div className="deck-gap-legend">
      <button
        type="button"
        className="deck-gap-legend-trigger"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <ChevronDown width={13} height={13} strokeWidth={2} aria-hidden />
        ) : (
          <ChevronRight width={13} height={13} strokeWidth={2} aria-hidden />
        )}
        What&rsquo;s this?
      </button>
      {open && (
        <p className="deck-gap-legend-body">
          The inclusion % is the share of EDHREC {subject} that run the card — a popularity proxy,
          not a quality verdict.
        </p>
      )}
    </div>
  );
}
