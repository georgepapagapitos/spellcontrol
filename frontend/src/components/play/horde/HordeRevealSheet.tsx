import { Sheet } from '@/components/overlays/Sheet';
import { PlaytestCardFace } from '@/playtest/components/PlaytestCardFace';
import type { PlaytestCard } from '@/lib/playtest';
import './horde-sheets.css';
import { Button } from '@/components/shared/Button';

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
  const spells = revealed.filter((c) => toResolveIds.has(c.id));

  return (
    <Sheet
      inPlace
      dismissable={false}
      onClose={onConfirm}
      className="horde-reveal-sheet"
      title="The horde reveals"
      footer={(close) => (
        <>
          <Button variant="primary" onClick={() => close()}>
            Confirm
          </Button>
        </>
      )}
    >
      {revealed.length === 0 ? (
        <p className="horde-reveal-empty">The horde has nothing left to reveal.</p>
      ) : (
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
      )}
      {spells.length > 0 && (
        <p className="horde-reveal-callout" role="status">
          The horde casts {spells.map((c) => c.name).join(', ')}. Resolve{' '}
          {spells.length === 1 ? 'it' : 'them'}, then confirm.
        </p>
      )}
    </Sheet>
  );
}
