import { useEffect, useRef, useState } from 'react';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { useEscapeKey } from '@/lib/use-escape-key';
import type { Zone } from '@/lib/playtest';

interface Props {
  x: number;
  y: number;
  cardName: string;
  variant?: 'floating' | 'sheet';
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

const MENU_MARGIN = 8;

export function CardContextMenu({
  x,
  y,
  cardName,
  variant = 'floating',
  onClose,
  onTap,
  onAddCounter,
  onRemoveCounter,
  onFlip,
  onMoveTo,
}: Props) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [clamped, setClamped] = useState<{ left: number; top: number } | null>(null);

  useLockBodyScroll();
  useEscapeKey(onClose);

  useEffect(() => {
    if (variant !== 'floating') return;
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(MENU_MARGIN, Math.min(x, vw - rect.width - MENU_MARGIN));
    const top = Math.max(MENU_MARGIN, Math.min(y, vh - rect.height - MENU_MARGIN));
    setClamped({ left, top });
  }, [x, y, variant]);

  // Action list — identical markup in both variants; only the surrounding
  // chrome differs (a cursor-anchored popover vs. the shared bottom sheet).
  const items = (
    <>
      <button type="button" className="playtest-ctx-action" onClick={onTap}>
        Tap / Untap
      </button>
      <button type="button" className="playtest-ctx-action" onClick={onFlip}>
        Flip face
      </button>
      <div className="playtest-ctx-group">
        <div className="playtest-ctx-heading">Counters</div>
        {COUNTER_KINDS.map((k) => (
          <div key={k} className="playtest-ctx-counter">
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
      <div className="playtest-ctx-group">
        <div className="playtest-ctx-heading">Move to</div>
        {ZONES.map((z) => (
          <button
            key={z.key}
            type="button"
            className="playtest-ctx-action"
            onClick={() => onMoveTo(z.key)}
          >
            {z.label}
          </button>
        ))}
      </div>
    </>
  );

  if (variant === 'sheet') {
    return (
      <div className="card-picker-root" role="presentation" onClick={onClose}>
        <div className="card-picker-backdrop" />
        <div
          className="card-picker-sheet playtest-ctx-sheet"
          role="dialog"
          aria-modal="true"
          aria-label={cardName}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="card-picker-handle" aria-hidden />
          <div className="card-picker-header">
            <h2 className="card-picker-title">{cardName}</h2>
          </div>
          <div className="playtest-ctx-menu">{items}</div>
          <div className="card-picker-footer">
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="playtest-ctx__backdrop" onClick={onClose} />
      <div
        ref={menuRef}
        className="playtest-ctx playtest-ctx-menu"
        style={{
          left: clamped?.left ?? x,
          top: clamped?.top ?? y,
          visibility: clamped ? 'visible' : 'hidden',
        }}
        role="menu"
        aria-label={cardName}
      >
        {items}
      </div>
    </>
  );
}
