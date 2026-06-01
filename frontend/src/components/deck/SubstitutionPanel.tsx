import './SubstitutionPanel.css';
import { useMemo } from 'react';
import type { MouseEvent } from 'react';
import type {
  SubstitutionPlan,
  SubstituteRow,
} from '@/deck-builder/services/deckBuilder/substituteFinder';
import { useCardCarousel } from './useCardCarousel';
import { VerdictBadge } from './VerdictBadge';

export interface SubstitutionPanelProps {
  plan: SubstitutionPlan;
  /** Add the owned substitute to the deck by name. */
  onAdd: (cardName: string) => void | Promise<void>;
  /** Names currently being added (disables their button). */
  addingNames?: Set<string>;
}

/** Same Scryfall named-image fallback the Cost/Engine panels use. */
function namedImage(name: string): string {
  return `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(
    name
  )}&format=image&version=small`;
}

function Row({
  row,
  adding,
  onAdd,
  onPreview,
}: {
  row: SubstituteRow;
  adding: boolean;
  onAdd: () => void;
  /** Open the wanted ⇄ owned carousel, starting at `name`. */
  onPreview: (name: string) => void;
}): JSX.Element {
  const previewClick = (name: string) => (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onPreview(name);
  };

  return (
    <li className="sub-row">
      <div className="sub-row-cards">
        <button
          type="button"
          className="sub-card sub-card-wanted"
          onClick={previewClick(row.wantedName)}
          aria-label={`Preview ${row.wantedName}`}
        >
          <img
            className="sub-thumb"
            src={namedImage(row.wantedName)}
            alt=""
            loading="lazy"
            decoding="async"
          />
          <span className="sub-card-text">
            <span className="sub-card-name">{row.wantedName}</span>
            <span className="sub-card-tag">
              Wanted{row.wantedRoleLabel ? ` · ${row.wantedRoleLabel}` : ''}
            </span>
          </span>
        </button>

        <span className="sub-arrow" aria-hidden>
          →
        </span>

        <button
          type="button"
          className="sub-card sub-card-used"
          onClick={previewClick(row.usedName)}
          aria-label={`Preview ${row.usedName}`}
        >
          <img
            className="sub-thumb"
            src={namedImage(row.usedName)}
            alt=""
            loading="lazy"
            decoding="async"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
          <span className="sub-card-text">
            <span className="sub-card-name">{row.usedName}</span>
            <span className="sub-card-owned" title="In your collection">
              Owned{row.usedSubtypeMatch ? ' · exact swap' : ''}
            </span>
          </span>
        </button>

        <button
          type="button"
          className="sub-add"
          onClick={onAdd}
          disabled={adding}
          aria-label={`Add ${row.usedName}`}
        >
          {adding ? 'Adding…' : 'Add'}
        </button>
      </div>
      <VerdictBadge
        verdict="substitute"
        label={row.usedSubtypeMatch ? 'Substitute · exact' : 'Substitute'}
        reason={row.reason}
        className="sub-verdict"
      />
    </li>
  );
}

/**
 * "From your collection" — for each EDHREC staple the deck is missing, the owned
 * card that fills the same role (within color identity), so a shopping list
 * becomes "Wanted X → Used Y you own." Mirrors the Cost/Engine panels: tap any
 * card to preview, Add to drop the owned substitute into the deck. Staples with
 * no owned fit are listed as genuine buys.
 */
export function SubstitutionPanel({
  plan,
  onAdd,
  addingNames,
}: SubstitutionPanelProps): JSX.Element {
  const adding = addingNames ?? new Set<string>();
  const carousel = useCardCarousel('Owned substitute');

  // Preview a substitution as a 2-card carousel: wanted ⇄ owned, starting at
  // the tapped card (same pattern as the Cost panel's swap preview).
  const openPreview = (row: SubstituteRow, tappedName: string) =>
    void carousel.open(
      [
        {
          name: row.wantedName,
          label: `Wanted${row.wantedRoleLabel ? ` · ${row.wantedRoleLabel}` : ''}`,
        },
        { name: row.usedName, label: 'Owned' },
      ],
      tappedName
    );

  const hasRows = plan.rows.length > 0;

  // Stable de-dupe of genuine buys (a staple can't be both substituted and
  // unmatched, but guard anyway).
  const unmatched = useMemo(() => Array.from(new Set(plan.unmatched)), [plan.unmatched]);

  if (!hasRows && unmatched.length === 0) {
    return (
      <section className="sub-panel" aria-label="Owned substitutes">
        <p className="sub-empty">
          No owned substitutes — the staples this deck wants aren&apos;t covered by cards in your
          collection yet.
        </p>
      </section>
    );
  }

  return (
    <section className="sub-panel" aria-label="Owned substitutes">
      {hasRows && (
        <ul className="sub-rows">
          {plan.rows.map((row) => (
            <Row
              key={row.wantedName}
              row={row}
              adding={adding.has(row.usedName)}
              onAdd={() => onAdd(row.usedName)}
              onPreview={(name) => openPreview(row, name)}
            />
          ))}
        </ul>
      )}

      {unmatched.length > 0 && (
        <div className="sub-unmatched">
          <h3 className="sub-unmatched-title">
            Still worth acquiring <span className="sub-unmatched-count">({unmatched.length})</span>
          </h3>
          <p className="sub-unmatched-hint">No owned card fills these slots — genuine buys.</p>
          <ul className="sub-unmatched-list">
            {unmatched.map((name) => (
              <li key={name} className="sub-unmatched-chip">
                {name}
              </li>
            ))}
          </ul>
        </div>
      )}

      {carousel.preview}
    </section>
  );
}
