import { useRef, type JSX } from 'react';
import { EyeOff } from 'lucide-react';
import './SuggestionDismissMenu.css';
import { OverflowMenu } from '../overlays/OverflowMenu';
import { focusNeighborAfterRemoval } from '@/lib/util/focus-neighbor';

/**
 * The quiet "Not for this deck" ⋮ on a suggestion row (E580). It is the row's own
 * overflow menu (STYLE_GUIDE § Verbs, Menus), so a right-click on the row, the
 * Context Menu key and Shift+F10 open it too, and it is the one place the action
 * lives: a menu item, not a second always-visible button beside the row's apply.
 *
 * `host` is the row's selector (for the right-click and to find the row);
 * `focusTarget` is what to focus in the neighboring row once this one is gone.
 */
export function SuggestionDismissMenu({
  name,
  host,
  focusTarget,
  onDismiss,
}: {
  name: string;
  host: string;
  focusTarget: string;
  onDismiss: () => void;
}): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  return (
    <span ref={ref} className="suggestion-menu">
      <OverflowMenu
        triggerClassName="suggestion-menu-trigger"
        ariaLabel={`More actions for ${name}`}
        contextHost={host}
        items={[
          {
            label: 'Not for this deck',
            icon: EyeOff,
            onClick: () => {
              focusNeighborAfterRemoval(
                ref.current?.closest<HTMLElement>(host) ?? null,
                host,
                focusTarget
              );
              onDismiss();
            },
          },
        ]}
      />
    </span>
  );
}
