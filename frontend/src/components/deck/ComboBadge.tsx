import './ComboBadge.css';
import type { ComboMatch } from '@/types/combos';
import { InfoTip } from '../InfoTip';

export interface ComboBadgeProps {
  /** Oracle id of the row this badge is attached to — highlighted within
   *  each combo's piece list so "which card here am I" is unambiguous. */
  oracleId: string;
  /** Every combo (in-deck or one-away) this card touches. Empty/undefined
   *  renders nothing — a row with no combo carries no badge and no
   *  reserved space, so the list never shifts between rows. */
  matches: ComboMatch[] | undefined;
}

/**
 * Small superscript "CB" / "CB2" indicator for a deck row whose card
 * participates in one or more combos already surfaced by the deck's Combos
 * panel (DeckCombosPanel / useDeckCombos) — this reuses that exact bucketed
 * data rather than running a second match, so the two surfaces can never
 * disagree about which combos apply to this deck.
 *
 * Built on InfoTip for the reveal (hover, keyboard focus, and touch all open
 * it; portaled to <body> so it escapes any clipping/containing-block
 * ancestor) rather than a bespoke popover.
 */
export function ComboBadge({ oracleId, matches }: ComboBadgeProps) {
  if (!matches || matches.length === 0) return null;
  const count = matches.length;
  const glyph = count === 1 ? 'CB' : `CB${count}`;
  const ariaLabel = count === 1 ? 'In 1 combo' : `In ${count} combos`;

  return (
    <InfoTip
      className="combo-badge-tip"
      label="combos"
      ariaLabel={ariaLabel}
      icon={
        <span className="combo-badge-glyph" aria-hidden>
          {glyph}
        </span>
      }
      text={
        <>
          <p className="info-tip-lead">{ariaLabel}:</p>
          <ul className="info-tip-list">
            {matches.map((m) => (
              <li key={m.combo.id}>
                {m.combo.cards.map((c, i) => (
                  <span key={c.oracleId}>
                    {i > 0 && ' + '}
                    <span className={c.oracleId === oracleId ? 'combo-badge-current' : undefined}>
                      {c.cardName}
                    </span>
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </>
      }
    />
  );
}
