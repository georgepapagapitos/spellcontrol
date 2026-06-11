import { MoreVertical, type LucideIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { useMenuKeyboard } from '@/lib/use-menu-keyboard';

export interface OverflowMenuItem {
  label: string;
  onClick: () => void;
  icon?: LucideIcon;
  danger?: boolean;
}

interface Props {
  items: OverflowMenuItem[];
  /** aria-label + title for the kebab trigger. */
  ariaLabel?: string;
  /** Class on the wrapper — e.g. to gate visibility by breakpoint. */
  className?: string;
  /** Class on the trigger button — pass `pill-btn` to match a toolbar row. */
  triggerClassName?: string;
}

/**
 * A `⋮` kebab that collapses a short list of secondary actions into a popover.
 * Lightweight, non-portaled (anchors to its own relatively-positioned wrapper),
 * so it's meant for un-clipped contexts like a page hero — not virtualized rows
 * (use CardRowMenu there). Reuses the shared `.deck-row-menu-*` popover styles.
 */
export function OverflowMenu({
  items,
  ariaLabel = 'More actions',
  className,
  triggerClassName,
}: Props) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const { closeAndReturnFocus } = useMenuKeyboard({
    open,
    onClose: () => setOpen(false),
    panelRef,
    triggerRef: buttonRef,
  });

  return (
    <div className={`overflow-menu${className ? ` ${className}` : ''}`}>
      <button
        ref={buttonRef}
        type="button"
        className={triggerClassName}
        aria-label={ariaLabel}
        title={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        data-open={open || undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreVertical width={16} height={16} strokeWidth={2} aria-hidden />
      </button>
      {open && (
        <div ref={panelRef} className="deck-row-menu-popover overflow-menu-popover" role="menu">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={`deck-row-menu-item${item.danger ? ' deck-row-menu-item--danger' : ''}`}
                onClick={() => {
                  closeAndReturnFocus();
                  item.onClick();
                }}
              >
                {Icon && <Icon width={14} height={14} strokeWidth={1.7} aria-hidden />}
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
