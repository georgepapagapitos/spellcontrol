import type { Zone } from '@/lib/playtest';

interface Props {
  x: number;
  y: number;
  onClose(): void;
  onTap(): void;
  onAddCounter(kind: string): void;
  onRemoveCounter(kind: string): void;
  onFlip(): void;
  onMoveTo(zone: Zone): void;
}

const COUNTER_KINDS = ['+1/+1', '-1/-1', 'loyalty', 'charge'];
const ZONES: { key: Zone; label: string }[] = [
  { key: 'hand', label: 'Hand' },
  { key: 'graveyard', label: 'Graveyard' },
  { key: 'exile', label: 'Exile' },
  { key: 'library', label: 'Library (bottom)' },
  { key: 'command', label: 'Command' },
];

export function CardContextMenu({
  x,
  y,
  onClose,
  onTap,
  onAddCounter,
  onRemoveCounter,
  onFlip,
  onMoveTo,
}: Props) {
  return (
    <>
      <div className="playtest-ctx__backdrop" onClick={onClose} />
      <div className="playtest-ctx" style={{ left: x, top: y }} role="menu">
        <button type="button" onClick={onTap}>
          Tap / Untap
        </button>
        <button type="button" onClick={onFlip}>
          Flip face
        </button>
        <div className="playtest-ctx__group">
          <div className="playtest-ctx__heading">Counters</div>
          {COUNTER_KINDS.map((k) => (
            <div key={k} className="playtest-ctx__counterRow">
              <span>{k}</span>
              <button type="button" onClick={() => onRemoveCounter(k)} aria-label={`remove ${k}`}>
                −
              </button>
              <button type="button" onClick={() => onAddCounter(k)} aria-label={`add ${k}`}>
                +
              </button>
            </div>
          ))}
        </div>
        <div className="playtest-ctx__group">
          <div className="playtest-ctx__heading">Move to</div>
          {ZONES.map((z) => (
            <button key={z.key} type="button" onClick={() => onMoveTo(z.key)}>
              {z.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
