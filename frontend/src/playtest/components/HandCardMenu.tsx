import type { Zone } from '@/lib/playtest';
import type { ShortcutId } from '../lib/shortcuts';
import { createTokenEntries, moveToEntries, type MadeToken } from './menu-entries';
import { SEPARATOR, TableContextMenu, type MenuEntry } from './TableContextMenu';

interface Props {
  x: number;
  y: number;
  cardName: string;
  /** Where the card is. The hand gets the hand's whole vocabulary; a
   *  commander in the command zone gets EDHPlay's shorter list for it. */
  zone?: 'hand' | 'command';
  variant: 'floating' | 'sheet';
  /** The live binding for a shortcut, formatted for display — the same keys
   *  the board listens for on the card under the pointer. */
  keyFor?(id: ShortcutId): string | undefined;
  onClose(): void;
  /** Omitted (no item) when the card has no resolvable ScryfallCard. */
  onPreview?(): void;
  /** Onto the battlefield. Out of the command zone that is casting it, and
   *  the reducer bumps that commander's tax. */
  onPlay(opts?: { tapped?: boolean; faceDown?: boolean }): void;
  onMoveTo(zone: Zone, toIndex?: number): void;
  /** The tokens this card makes, for EDHPlay's Create token submenu. Empty
   *  or omitted (a card that makes none) shows no row. */
  tokens?: readonly MadeToken[];
  onCreateToken?(token: MadeToken): void;
  /** Caps "Library X from top"; omitted hides that row. */
  libraryCount?: number;
  /** Whether the table is currently being shown this card. */
  revealed?: boolean;
  /** Show it to the table, or stop. Omitted off a table — there is nobody
   *  to show it to in a solo goldfish, and an item that does nothing is
   *  worse than no item. */
  onToggleReveal?(): void;
  /** Put it on the stack — casting it, in the only sense a
   *  manual-enforcement table means that word. */
  onPutOnStack?(copy: boolean): void;
  /** Moves the card one place towards the start / end of the hand. The
   *  keyboard and screen-reader path to arranging a hand (dragging is the
   *  pointer one); omitted, or passed `false` at either end, hides the row. */
  onMove?(direction: -1 | 1): void;
  canMoveEarlier?: boolean;
  canMoveLater?: boolean;
}

/**
 * Right-click / long-press / Shift+Enter menu for a card in hand or in the
 * command zone, grouped the way EDHPlay groups it: where it goes / how it is
 * shown / tokens and the stack / information. Playing a card is Move to ▸
 * Battlefield (A), as it is there; a click on a hand card still plays it.
 *
 * The hand keeps two things EDHPlay does without: "Battlefield, tapped" under
 * Move to (a land's everyday case), and Move it left / right at the end, the
 * keyboard's way of arranging a hand.
 */
export function HandCardMenu({
  x,
  y,
  cardName,
  zone = 'hand',
  variant,
  keyFor,
  onClose,
  onPreview,
  onPlay,
  onMoveTo,
  libraryCount,
  tokens = [],
  onCreateToken,
  revealed = false,
  onToggleReveal,
  onPutOnStack,
  onMove,
  canMoveEarlier = false,
  canMoveLater = false,
}: Props) {
  const key = (id: ShortcutId) => keyFor?.(id);
  const inHand = zone === 'hand';
  const items: MenuEntry[] = [
    {
      label: 'Move to',
      items: moveToEntries({
        from: zone,
        keyFor,
        libraryCount,
        onMoveTo: (to, toIndex) => {
          onMoveTo(to, toIndex);
          onClose();
        },
        // Out of the command zone this is casting it; a commander never
        // needs the tapped way in.
        onBattlefield: () => onPlay(),
        onBattlefieldTapped: inHand ? () => onPlay({ tapped: true }) : undefined,
      }),
    },
    SEPARATOR,
    ...(inHand
      ? [
          {
            label: 'Play face down',
            shortcut: key('face-down'),
            onClick: () => onPlay({ faceDown: true }),
          },
        ]
      : []),
    ...(inHand && onToggleReveal
      ? [
          {
            label: 'Reveal',
            shortcut: key('reveal'),
            // EDHPlay's shape, Reveal ▸ Everyone, and the library menu's: a
            // reveal names who sees it.
            items: [{ label: 'Everyone', pressed: revealed, onClick: onToggleReveal }],
          },
        ]
      : []),
    SEPARATOR,
    ...(onCreateToken ? createTokenEntries(tokens, onCreateToken) : []),
    ...(onPutOnStack
      ? [
          {
            label: 'Add to the stack',
            shortcut: key('stack-add'),
            onClick: () => onPutOnStack(false),
          },
        ]
      : []),
    SEPARATOR,
    ...(onPreview ? [{ label: 'View information', onClick: onPreview }] : []),
    SEPARATOR,
    ...(onMove && canMoveEarlier ? [{ label: 'Move it left', onClick: () => onMove(-1) }] : []),
    ...(onMove && canMoveLater ? [{ label: 'Move it right', onClick: () => onMove(1) }] : []),
  ];
  return (
    <TableContextMenu
      x={x}
      y={y}
      variant={variant}
      title={cardName}
      items={items}
      onClose={onClose}
    />
  );
}
