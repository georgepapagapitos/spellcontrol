import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useMenuKeyboard } from '../../lib/use-menu-keyboard';
import { hubPetalPositions, type Point } from '../../lib/board-hub-layout';
import './BoardHubMenu.css';

export interface HubPetal {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
}

/**
 * The board hub's radial petal menu (Lotus's fan-out ring): tapping the hub
 * (outside commander-damage mode) mounts this instead of opening the game
 * menu directly. Screen-relative, like the hub itself — positions are
 * computed from the hub's on-screen rect, not from the board's rotated seat
 * space, so the ring reads upright for whoever is holding the device.
 *
 * `useMenuKeyboard` supplies the real WAI-ARIA menu behaviour for free: focus
 * moves into the first petal on open, Arrow/Home/End roam the ring, Escape
 * and an outside tap close it and return focus to the hub. A backdrop sits
 * behind the petals — not to dim the board (the ring is a quick glance, not a
 * takeover) but so a tap meant to dismiss the ring lands on the backdrop
 * instead of falling through to whatever panel is underneath it, the same
 * hazard `.game-menu-backdrop` already guards against.
 */
export function BoardHubMenu({
  hubRef,
  onClose,
  petals,
}: {
  hubRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  petals: HubPetal[];
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [points, setPoints] = useState<Point[]>([]);

  useLayoutEffect(() => {
    const measure = () => {
      const btn = hubRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      setPoints(
        hubPetalPositions(
          { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
          { width: window.innerWidth, height: window.innerHeight },
          petals.length
        )
      );
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [hubRef, petals.length]);

  const { closeAndReturnFocus } = useMenuKeyboard({
    open: true,
    onClose,
    panelRef,
    triggerRef: hubRef,
  });

  return (
    <>
      <div className="board-hub-backdrop" aria-hidden="true" />
      <div ref={panelRef} className="board-hub-ring" role="menu" aria-label="Board menu">
        {petals.map((petal, i) => {
          const pos = points[i];
          return (
            <button
              key={petal.id}
              type="button"
              role="menuitem"
              className="board-hub-petal"
              style={pos ? { left: `${pos.x}px`, top: `${pos.y}px` } : { opacity: 0 }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                closeAndReturnFocus();
                petal.onSelect();
              }}
            >
              {petal.icon}
              <span>{petal.label}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}
