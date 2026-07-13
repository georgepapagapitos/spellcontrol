import { useState } from 'react';
import { isOpponentDefeated, type OpponentLife } from '@/lib/playtest';
import { LifeAdjustPanel } from './LifeAdjustPanel';

interface Props {
  life: number;
  opponents: OpponentLife[];
  commanderDamageThreshold: number;
  isNarrow: boolean;
  onAdjustLife(player: 'self' | number, delta: number): void;
  onAdjustCommanderDamage(opponent: number, delta: number): void;
  /** Lets the parent fold the adjust popover into its "any sheet open" gate
   *  (e.g. to suspend keyboard shortcuts while it's up). */
  onOpenChange?(open: boolean): void;
}

type Selected = 'self' | number | null;

/**
 * Compact life/commander-damage strip: you + N virtual opponents as tappable
 * chips (E138). One row, doesn't displace the battlefield — the adjust UI
 * lives entirely in a popover/sheet opened per chip.
 */
export function LifeStrip({
  life,
  opponents,
  commanderDamageThreshold,
  isNarrow,
  onAdjustLife,
  onAdjustCommanderDamage,
  onOpenChange,
}: Props) {
  const [selected, setSelected] = useState<Selected>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  function openPanel(target: Selected, e: React.MouseEvent<HTMLButtonElement>) {
    setAnchorRect(e.currentTarget.getBoundingClientRect());
    setSelected(target);
    onOpenChange?.(true);
  }

  function closePanel() {
    setSelected(null);
    onOpenChange?.(false);
  }

  const opponentLabel = (i: number) => (opponents.length > 1 ? `Opponent ${i + 1}` : 'Opponent');

  return (
    <div className="playtest-life-strip" role="group" aria-label="Life totals">
      <button
        type="button"
        className="playtest-life-chip"
        onClick={(e) => openPanel('self', e)}
        aria-label={`You: ${life} life`}
      >
        <span className="playtest-life-chip__label">You</span>
        <span className="playtest-life-chip__life">{life}</span>
      </button>
      {opponents.map((o, i) => {
        const defeated = isOpponentDefeated(o, commanderDamageThreshold);
        return (
          <button
            key={i}
            type="button"
            className={`playtest-life-chip playtest-life-chip--opponent${
              defeated ? ' is-defeated' : ''
            }`}
            onClick={(e) => openPanel(i, e)}
            aria-label={`${opponentLabel(i)}: ${o.life} life${
              o.commanderDamage > 0 ? `, ${o.commanderDamage} commander damage` : ''
            }${defeated ? ', defeated' : ''}`}
          >
            <span className="playtest-life-chip__label">
              {opponents.length > 1 ? `Opp ${i + 1}` : 'Opponent'}
            </span>
            <span className="playtest-life-chip__life">{o.life}</span>
            {o.commanderDamage > 0 && (
              <span className="playtest-life-chip__cmdr" aria-hidden>
                {o.commanderDamage}
              </span>
            )}
            {defeated && (
              <span className="playtest-life-chip__skull" aria-hidden>
                ☠
              </span>
            )}
          </button>
        );
      })}

      {selected !== null && (
        <LifeAdjustPanel
          variant={isNarrow ? 'sheet' : 'floating'}
          anchorRect={anchorRect}
          title={selected === 'self' ? 'You' : opponentLabel(selected)}
          life={selected === 'self' ? life : opponents[selected].life}
          commanderDamage={selected === 'self' ? undefined : opponents[selected].commanderDamage}
          commanderDamageThreshold={commanderDamageThreshold}
          defeated={
            selected !== 'self' && isOpponentDefeated(opponents[selected], commanderDamageThreshold)
          }
          onClose={closePanel}
          onAdjustLife={(delta) => onAdjustLife(selected, delta)}
          onAdjustCommanderDamage={
            selected === 'self' ? undefined : (delta) => onAdjustCommanderDamage(selected, delta)
          }
        />
      )}
    </div>
  );
}
