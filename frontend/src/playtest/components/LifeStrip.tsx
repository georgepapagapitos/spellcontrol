import { useState } from 'react';
import { isOpponentDefeated, type OpponentLife } from '@/lib/playtest';
import { LifeAdjustPanel } from './LifeAdjustPanel';

interface Props {
  life: number;
  opponents: OpponentLife[];
  commanderDamageThreshold: number;
  isNarrow: boolean;
  /** Table designations you currently hold — badged on the "You" chip only;
   *  solo play has no per-opponent holder to badge. */
  monarch: boolean;
  initiative: boolean;
  citysBlessing: boolean;
  /** Your own player-scoped counters; each opponent's live on `opponents[i]`. */
  playerCounters: Record<string, number>;
  onAdjustLife(player: 'self' | number, delta: number): void;
  onAdjustCommanderDamage(opponent: number, delta: number): void;
  onAdjustCounter(player: 'self' | number, kind: string, delta: number): void;
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
  monarch,
  initiative,
  citysBlessing,
  playerCounters,
  onAdjustLife,
  onAdjustCommanderDamage,
  onAdjustCounter,
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

  /** "poison 3, energy 1" — reused for both the aria-label and the visible
   *  badges so the two can never describe different state. */
  const counterEntries = (bag: Record<string, number> | undefined) =>
    Object.entries(bag ?? {}).filter(([, v]) => v > 0);

  const heldDesignationLabels = [
    monarch && 'Monarch',
    initiative && 'Initiative',
    citysBlessing && "City's Blessing",
  ].filter((label): label is string => Boolean(label));

  const selfCounters = counterEntries(playerCounters);

  return (
    <div className="playtest-life-strip" role="group" aria-label="Life totals">
      <button
        type="button"
        className="playtest-life-chip"
        onClick={(e) => openPanel('self', e)}
        aria-label={`You: ${life} life${
          heldDesignationLabels.length > 0 ? `, ${heldDesignationLabels.join(', ')}` : ''
        }${selfCounters.length > 0 ? `, ${selfCounters.map(([k, v]) => `${k} ${v}`).join(', ')}` : ''}`}
      >
        <span className="playtest-life-chip__label">You</span>
        {heldDesignationLabels.length > 0 && (
          <span className="playtest-life-chip__designations" aria-hidden>
            {monarch && <span className="playtest-designation-badge">👑</span>}
            {initiative && <span className="playtest-designation-badge">🧭</span>}
            {citysBlessing && <span className="playtest-designation-badge">🏙️</span>}
          </span>
        )}
        <span className="playtest-life-chip__life">{life}</span>
        {selfCounters.length > 0 && (
          <span className="playtest-life-chip__counters" aria-hidden>
            {selfCounters.map(([k, v]) => (
              <span key={k} className="playtest-life-chip__counter" title={k}>
                {k.slice(0, 3)}:{v}
              </span>
            ))}
          </span>
        )}
      </button>
      {opponents.map((o, i) => {
        const defeated = isOpponentDefeated(o, commanderDamageThreshold);
        const oppCounters = counterEntries(o.counters);
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
            }${
              oppCounters.length > 0
                ? `, ${oppCounters.map(([k, v]) => `${k} ${v}`).join(', ')}`
                : ''
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
            {oppCounters.length > 0 && (
              <span className="playtest-life-chip__counters" aria-hidden>
                {oppCounters.map(([k, v]) => (
                  <span key={k} className="playtest-life-chip__counter" title={k}>
                    {k.slice(0, 3)}:{v}
                  </span>
                ))}
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
          counters={(selected === 'self' ? playerCounters : opponents[selected].counters) ?? {}}
          onClose={closePanel}
          onAdjustCounter={(kind, delta) => onAdjustCounter(selected, kind, delta)}
          onAdjustLife={(delta) => onAdjustLife(selected, delta)}
          onAdjustCommanderDamage={
            selected === 'self' ? undefined : (delta) => onAdjustCommanderDamage(selected, delta)
          }
        />
      )}
    </div>
  );
}
