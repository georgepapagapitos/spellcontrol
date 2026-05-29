import './GapAnalysisPanel.css';
import type { GapAnalysisCard } from '@/deck-builder/types';

const MAX_SHOWN = 18;

export function GapAnalysisPanel({
  cards,
  ownedNames,
}: {
  cards: GapAnalysisCard[];
  /** Owned-card names so rows can flag what the user already has. */
  ownedNames?: Set<string>;
}): JSX.Element | null {
  if (cards.length === 0) return null;

  const shown = cards.slice(0, MAX_SHOWN);
  const overflow = cards.length - shown.length;

  return (
    <ul className="gap-analysis-list" aria-label="Cards to consider">
      {shown.map((card) => {
        const owned = card.isOwned || ownedNames?.has(card.name) || false;
        return (
          <li key={card.name} className="gap-analysis-row">
            <div className="gap-analysis-main">
              <span className="gap-analysis-name">{card.name}</span>
              {owned && (
                <span className="gap-analysis-owned" title="Already in your collection">
                  Owned
                </span>
              )}
            </div>
            <div className="gap-analysis-meta">
              {card.roleLabel && <span className="gap-analysis-role">{card.roleLabel}</span>}
              <span className="gap-analysis-inclusion" title="EDHREC inclusion rate">
                {Math.round(card.inclusion)}%
              </span>
              {card.price && <span className="gap-analysis-price">${card.price}</span>}
            </div>
          </li>
        );
      })}
      {overflow > 0 && <li className="gap-analysis-overflow">+{overflow} more</li>}
    </ul>
  );
}
