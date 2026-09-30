import type { LibraryReveal, PlaytestAction, PlaytestState, Zone } from '@/lib/playtest';
import { MOVE_DESTINATIONS } from '../../lib/zones';
import type { ShortcutId } from '../../lib/shortcuts';
import type { OnlineTable } from '../../hooks/use-online-table';
import { CountPage } from '../CountPage';
import { SEPARATOR, type MenuEntry } from '../TableContextMenu';
import type { ViewerMode } from '../../lib/board-support';

/** What the pile menus read from the board. */
export interface PileMenuContext {
  state: PlaytestState;
  dispatch: (action: PlaytestAction) => void;
  onlineTable: OnlineTable | null;
  keyFor: (id: ShortcutId) => string | undefined;
  libraryCount: number;
  libraryReveal: LibraryReveal;
  doDraw: () => void;
  peekZone: (where: 'top' | 'bottom' | 'random', zone?: Zone) => boolean;
  setViewer: (viewer: ViewerMode) => void;
  setPileMenu: (menu: null) => void;
  setScryFrom: (from: 'top' | 'bottom') => void;
  setShowScry: (show: boolean) => void;
}

/**
 * A pile's menu. Every action that belongs to a zone lives here, on the
 * zone, reachable by right-click, the Context Menu key or the tile's
 * kebab — they used to be spread across the game menu and the table menu,
 * which is how both grew past reading. Rows print their key, so the menu
 * is also where the library's shortcuts are discovered.
 */
export function buildPileMenuItems(zone: Zone, ctx: PileMenuContext): MenuEntry[] {
  const {
    state,
    dispatch,
    onlineTable,
    keyFor,
    libraryCount,
    libraryReveal,
    doDraw,
    peekZone,
    setViewer,
    setPileMenu,
    setScryFrom,
    setShowScry,
  } = ctx;
  /**
   * Empty this whole zone into another. Every destination the card menu's
   * "Move to" offers, minus the zone the cards are already in — and minus
   * the battlefield, which `MOVE_DESTINATIONS` already leaves out and which
   * has no sensible layout for N cards landing at once.
   */
  const moveAllItems = (from: Zone): MenuEntry[] =>
    // Not the command zone: nobody moves a whole graveyard there.
    MOVE_DESTINATIONS.filter((d) => d.key !== from && d.key !== 'command').map((d) => {
      // Everyone watched these cards go in, so a block that keeps its order
      // would hand the caster a known deck order. The row says so, because
      // "my graveyard is now the top of my library, in order" is a very
      // different promise from what actually happens.
      const random = d.key === 'library';
      return {
        label: random ? `${d.label} (random order)` : d.label,
        onClick: () =>
          dispatch({ type: 'MOVE_ALL_TO', from, to: d.key, toIndex: d.toIndex, random }),
      };
    });

  const empty = state.zones[zone].length === 0;
  const moveAll = { label: 'Move all to', items: moveAllItems(zone), disabled: empty };
  if (zone === 'hand') {
    // EDHPlay's hand menu, in its order. As on the library, the reveals
    // need a table to show anything to, so solo play leaves them out.
    const handRevealed = Boolean(state.handRevealed);
    return [
      ...(onlineTable
        ? [
            {
              label: 'Reveal hand',
              disabled: empty,
              items: [{ label: 'Everyone', onClick: () => dispatch({ type: 'REVEAL_HAND' }) }],
            },
            {
              label: 'Play with hand revealed',
              items: [
                {
                  label: 'Everyone',
                  pressed: handRevealed,
                  onClick: () => dispatch({ type: 'SET_HAND_REVEALED', revealed: !handRevealed }),
                },
              ],
            },
          ]
        : []),
      {
        label: 'Discard at random',
        onClick: () => dispatch({ type: 'DISCARD_RANDOM' }),
        disabled: empty,
      },
      moveAll,
      { label: 'View all', onClick: () => setViewer({ zone }), disabled: empty },
    ];
  }
  if (zone !== 'library') {
    // EDHPlay's: View all / Select random card, Move all to. Shuffling the
    // pile into the library is ours.
    return [
      { label: 'View all', onClick: () => setViewer({ zone }), disabled: empty },
      SEPARATOR,
      ...(zone === 'graveyard' || zone === 'exile'
        ? [
            {
              label: 'Select a random card',
              onClick: () => void peekZone('random', zone),
              disabled: empty,
            },
            moveAll,
            {
              label: 'Shuffle into the library',
              onClick: () => dispatch({ type: 'SHUFFLE_ZONE_INTO_LIBRARY', zone }),
              disabled: empty,
            },
          ]
        : [moveAll]),
    ];
  }

  /** Set the standing reveal, or clear it by picking the mode it is in. */
  const setReveal = (reveal: LibraryReveal) => () =>
    dispatch({
      type: 'SET_LIBRARY_REVEAL',
      reveal: libraryReveal === reveal ? 'none' : reveal,
    });

  return [
    { label: 'Draw a card', shortcut: keyFor('draw'), onClick: doDraw, disabled: empty },
    {
      label: 'Draw several',
      disabled: empty,
      content: (
        <CountPage
          max={libraryCount}
          initial={2}
          label={(n) => `Draw ${n} card${n === 1 ? '' : 's'}`}
          onConfirm={(n) => {
            setPileMenu(null);
            dispatch({ type: 'DRAW', n });
          }}
        />
      ),
    },
    {
      // Bulk mill and bulk exile: take N off the top without looking at
      // them one by one, which is what the scry sheet behind View is for.
      label: 'Move top cards to',
      disabled: empty,
      items: [
        {
          label: 'Graveyard',
          content: (
            <CountPage
              max={libraryCount}
              label={(n) => `Mill ${n} card${n === 1 ? '' : 's'}`}
              onConfirm={(n) => {
                setPileMenu(null);
                dispatch({ type: 'MOVE_TOP_N', n, to: 'graveyard' });
              }}
            />
          ),
        },
        {
          label: 'Exile',
          content: (
            <CountPage
              max={libraryCount}
              label={(n) => `Exile ${n} card${n === 1 ? '' : 's'}`}
              onConfirm={(n) => {
                setPileMenu(null);
                dispatch({ type: 'MOVE_TOP_N', n, to: 'exile' });
              }}
            />
          ),
        },
        {
          label: 'Exile face down',
          content: (
            <CountPage
              max={libraryCount}
              label={(n) => `Exile ${n} card${n === 1 ? '' : 's'} face down`}
              onConfirm={(n) => {
                setPileMenu(null);
                dispatch({ type: 'MOVE_TOP_N', n, to: 'exile', faceDown: true });
              }}
            />
          ),
        },
      ],
    },
    {
      // Five ways of looking, grouped rather than spent as five rows on the
      // root — the keys are the ones the board already listens for.
      label: 'View',
      disabled: empty,
      items: [
        { label: 'Top card', onClick: () => void peekZone('top') },
        { label: 'Bottom card', onClick: () => void peekZone('bottom') },
        {
          // The sheet picks the mode (scry / surveil / mill) and the count,
          // so the row stays generic — a fixed "Scry 3" would mislead.
          label: 'Top X cards',
          shortcut: keyFor('scry'),
          onClick: () => {
            setScryFrom('top');
            setShowScry(true);
          },
        },
        {
          label: 'Bottom X cards',
          shortcut: keyFor('scry-bottom'),
          onClick: () => {
            setScryFrom('bottom');
            setShowScry(true);
          },
        },
        {
          label: 'All',
          shortcut: keyFor('view-library'),
          onClick: () => setViewer({ zone: 'library' }),
        },
      ],
    },
    {
      label: 'Shuffle',
      shortcut: keyFor('shuffle'),
      onClick: () => dispatch({ type: 'SHUFFLE_LIBRARY' }),
    },
    { label: 'Select a random card', onClick: () => void peekZone('random'), disabled: empty },
    // Showing something to the table needs a table. Solo, every "Everyone"
    // is an audience of nobody, so the one-shot reveals are not offered at
    // all and the standing one collapses to its private half.
    ...(onlineTable
      ? [
          {
            label: 'Reveal top card',
            disabled: empty,
            items: [
              {
                // One-shot, and an event rather than a mode: the ticker
                // line naming the card is the whole of it.
                label: 'Everyone',
                onClick: () => dispatch({ type: 'REVEAL_TOP_CARD' }),
              },
              { label: 'Me', onClick: () => void peekZone('top') },
            ],
          },
          {
            // No "Me": you can already read your own library with All.
            label: 'Reveal library',
            disabled: empty,
            items: [
              { label: 'Everyone', pressed: libraryReveal === 'all', onClick: setReveal('all') },
            ],
          },
          {
            label: 'Play with top revealed',
            disabled: empty,
            items: [
              { label: 'Everyone', pressed: libraryReveal === 'top', onClick: setReveal('top') },
              { label: 'Me', pressed: libraryReveal === 'top-me', onClick: setReveal('top-me') },
            ],
          },
        ]
      : [
          {
            // Solo this is simply "keep my top card face up", so it is the
            // private mode and a plain toggle rather than a choice of
            // audience. It stays private if this seat later joins a table.
            label: 'Play with top revealed',
            pressed: libraryReveal === 'top-me',
            onClick: setReveal('top-me'),
            disabled: empty,
          },
        ]),
    moveAll,
  ];
}
