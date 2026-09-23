import type { Zone } from '@/lib/playtest';
import { MOVE_DESTINATIONS, destinationKey } from '../lib/zones';
import type { ShortcutId } from '../lib/shortcuts';
import { CountPage } from './CountPage';
import type { MenuEntry } from './TableContextMenu';

/** Which shortcut each Move-to destination answers to, so the submenu prints
 *  the same keys the board already listens for. The command zone has none. */
const MOVE_SHORTCUT: Record<string, ShortcutId | undefined> = {
  'hand:end': 'to-hand',
  'graveyard:end': 'to-graveyard',
  'exile:end': 'to-exile',
  'library:0': 'to-library-top',
  'library:end': 'to-library-bottom',
  'command:end': undefined,
};

/**
 * The "Move to" submenu every card menu shares, in EDHPlay's order: the
 * zones, the two ends of the library, anywhere between them, then the
 * command zone. `from` is left out, since the card is already there;
 * `onBattlefield` puts the battlefield first for a card that is not on it
 * (and `onBattlefieldTapped` the tapped way in, a land's everyday case).
 * The caller closes the menu in `onMoveTo` (the "X from top" confirm is a
 * control, not a row, so the menu does not close for it).
 */
export function moveToEntries({
  from,
  keyFor,
  libraryCount,
  onMoveTo,
  onBattlefield,
  onBattlefieldTapped,
}: {
  from: Zone | 'battlefield';
  keyFor?(id: ShortcutId): string | undefined;
  libraryCount?: number;
  onMoveTo(zone: Zone, toIndex?: number): void;
  onBattlefield?(): void;
  onBattlefieldTapped?(): void;
}): MenuEntry[] {
  const dests = MOVE_DESTINATIONS.filter((z) => z.key !== from);
  const row = (z: (typeof MOVE_DESTINATIONS)[number]): MenuEntry => {
    const id = MOVE_SHORTCUT[destinationKey(z)];
    return {
      label: z.label,
      shortcut: id && keyFor?.(id),
      onClick: () => onMoveTo(z.key, z.toIndex),
    };
  };
  return [
    ...(onBattlefield
      ? [{ label: 'Battlefield', shortcut: keyFor?.('to-battlefield'), onClick: onBattlefield }]
      : []),
    ...(onBattlefieldTapped
      ? [{ label: 'Battlefield, tapped', onClick: onBattlefieldTapped }]
      : []),
    ...dests.filter((z) => z.key !== 'command').map(row),
    // Top and bottom are the two ends; this is everywhere between them — a
    // tutor putting something back a few cards down, or a Brainstorm
    // leftover that should not be the next draw.
    ...(libraryCount !== undefined && libraryCount > 0 && from !== 'library'
      ? [
          {
            label: 'Library X from top',
            content: (
              <CountPage
                max={libraryCount}
                // 1 is the first position the two end rows do not already cover.
                initial={1}
                // Says the RESULT, not the index: "3 from the top" reads as
                // either the third card or the fourth depending on who you
                // ask, and burying a card in the wrong slot is invisible
                // until you draw it.
                label={(n) => `Put it under ${n} card${n === 1 ? '' : 's'}`}
                onConfirm={(n) => onMoveTo('library', n)}
              />
            ),
          },
        ]
      : []),
    ...dests.filter((z) => z.key === 'command').map(row),
  ];
}

/** A token a card makes, as Scryfall relates it to the card. */
export interface MadeToken {
  name: string;
  typeLine?: string;
}

/**
 * EDHPlay's "Create Token" submenu: the tokens THIS card makes (Tireless
 * Provisioner: Food, Treasure), each one a row. A card that makes none gets
 * no row at all rather than an empty submenu. Two tokens with one name (two
 * different Soldiers) are told apart by their type line.
 */
export function createTokenEntries(
  tokens: readonly MadeToken[],
  onCreate: (token: MadeToken) => void
): MenuEntry[] {
  if (tokens.length === 0) return [];
  const shared = (name: string) => tokens.filter((t) => t.name === name).length > 1;
  return [
    {
      label: 'Create token',
      items: tokens.map((t) => ({
        label:
          shared(t.name) && t.typeLine
            ? `${t.name} (${t.typeLine.replace(/^Token\s+/, '')})`
            : t.name,
        onClick: () => onCreate(t),
      })),
    },
  ];
}
