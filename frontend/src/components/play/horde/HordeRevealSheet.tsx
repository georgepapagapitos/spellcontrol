import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { useSheetExit } from '@/lib/use-sheet-exit';
import { PlaytestCardFace } from '@/playtest/components/PlaytestCardFace';
import type { PlaytestCard } from '@/lib/playtest';
import './horde-sheets.css';

interface Props {
  revealed: PlaytestCard[];
  toResolveIds: ReadonlySet<string>;
  waveEndId: string | null;
  onConfirm(): void;
}

/**
 * The horde turn's reveal sheet (design point 4): the revealed cards in
 * order, the wave-ending card outlined, and a callout for any instant/
 * sorcery to resolve by hand before confirming. Confirming is the only exit —
 * there is nothing to pick, so no backdrop/Escape dismiss (mirrors a Modal
 * with `dismissable={false}`, but built on the card-picker shell like every
 * other playtest sheet).
 */
export function HordeRevealSheet({ revealed, toResolveIds, waveEndId, onConfirm }: Props) {
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onConfirm);
  useLockBodyScroll();

  const spells = revealed.filter((c) => toResolveIds.has(c.id));

  return (
    <div className="card-picker-root">
      <div
        className={`card-picker-sheet horde-reveal-sheet${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="The horde reveals"
        onAnimationEnd={onAnimationEnd}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <h2 className="card-picker-title">The horde reveals</h2>
        </div>
        <div className="card-picker-list horde-reveal-list">
          {revealed.map((card, i) => (
            <div
              key={card.id}
              className={`horde-reveal-card${card.id === waveEndId ? ' is-wave-end' : ''}`}
            >
              <PlaytestCardFace card={card} size="sm" />
              <span className="horde-reveal-card-caption">
                {i + 1} · {card.id === waveEndId ? 'ends the wave' : card.name}
              </span>
            </div>
          ))}
        </div>
        {spells.length > 0 && (
          <p className="horde-reveal-callout" role="status">
            The horde casts {spells.map((c) => c.name).join(', ')}. Resolve{' '}
            {spells.length === 1 ? 'it' : 'them'}, then confirm.
          </p>
        )}
        <div className="card-picker-footer">
          <button type="button" className="btn btn-primary" onClick={() => beginClose()}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
