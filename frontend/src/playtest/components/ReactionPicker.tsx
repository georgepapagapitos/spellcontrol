import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMenuKeyboard } from '@/lib/use-menu-keyboard';
import { computePopoverPlacement, getSafeViewport } from '@/lib/popover-placement';
import { useOnlineSignals } from '../hooks/use-online-signals';
import { REACTION_EMOTES, REACTION_LABEL } from '../lib/table-signals';
import './ReactionPicker.css';

type PanelPos = { top?: number; bottom?: number; left?: number; right?: number };

/**
 * Online-only send affordance: a single trigger that opens a compact row of
 * the six whitelisted reaction emotes, one tap away. Mirrors
 * `components/OverflowMenu`'s trigger+portal+placement shape (§ Toolbars &
 * action rows) rather than reinventing popover mechanics, but the panel body
 * is a grid of emote buttons instead of a menu list. Renders nothing outside
 * an online, seated game — see `useOnlineSignals`.
 */
export function ReactionPicker() {
  const linked = useOnlineSignals();
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState<PanelPos | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const { closeAndReturnFocus } = useMenuKeyboard({
    open,
    onClose: () => setOpen(false),
    panelRef,
    triggerRef: buttonRef,
  });

  useLayoutEffect(() => {
    if (!open || !panelRef.current || !buttonRef.current) return;
    const anchorRect = buttonRef.current.getBoundingClientRect();
    const panelRect = panelRef.current.getBoundingClientRect();
    const placement = computePopoverPlacement(
      anchorRect,
      { width: panelRect.width, height: panelRect.height },
      getSafeViewport(),
      'right',
      4
    );
    setPanelPos({
      top: placement.top,
      bottom: placement.bottom,
      left: placement.left,
      right: placement.right,
    });
  }, [open]);

  if (!linked) return null;

  function handleToggle() {
    if (!open && buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect();
      setPanelPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
    }
    setOpen((v) => !v);
  }

  function send(emote: string) {
    closeAndReturnFocus();
    void linked?.sendSignal({ kind: 'reaction', emote });
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        title="Send a reaction"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={handleToggle}
      >
        React
      </button>
      {open &&
        panelPos &&
        createPortal(
          <div
            ref={panelRef}
            className="playtest-reaction-picker"
            role="menu"
            aria-label="Reactions"
            style={{
              position: 'fixed',
              top: panelPos.top,
              bottom: panelPos.bottom,
              left: panelPos.left,
              right: panelPos.right,
            }}
          >
            {REACTION_EMOTES.map((emote) => (
              <button
                key={emote}
                type="button"
                role="menuitem"
                className="playtest-reaction-picker__emote"
                aria-label={REACTION_LABEL[emote]}
                title={REACTION_LABEL[emote]}
                onClick={() => send(emote)}
              >
                <span aria-hidden>{emote}</span>
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
