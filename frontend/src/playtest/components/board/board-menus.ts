import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  Crown,
  Eraser,
  Flag,
  Gavel,
  Keyboard,
  LayoutGrid,
  LogOut,
  Maximize2,
  Minimize2,
  RotateCcw,
  Rows3,
  ScrollText,
  Settings,
  Undo2,
} from 'lucide-react';
import type { PlaytestState } from '@/lib/playtest';
import type { OnlineHordeResult } from '../../hooks/use-online-horde';
import type { OnlineTable } from '../../hooks/use-online-table';
import type { TakebackStatus } from '../../hooks/use-takeback';
import type { SoloHordeState } from '../../lib/horde-solo';
import { hordeLevelLabel } from '../../lib/horde-view';
import { RESISTANCE_LEVEL_LABEL, type ResistanceLevel } from '../../lib/resistance';
import { REACTION_EMOTES, REACTION_LABEL } from '../../lib/table-signals';
import { writeSnap, writeTurnAlert } from '../../lib/table-prefs';
import type { ShortcutId } from '../../lib/shortcuts';
import { TAKEBACK_MODE_LABEL } from '../../lib/takeback';
import type { GameMenuSection } from '../GameMenuSheet';
import type { SettingLink, SettingToggle } from '../TableSettingsSheet';
import { SEPARATOR, type MenuEntry } from '../TableContextMenu';

/** Everything you set once and forget lives behind "Table settings" (see
 *  `TableSettingsSheet`); the menu itself is actions. */
export function buildSettingsLinks({
  takeback,
  onlineTable,
  horde,
  resistanceLevel,
  setShowTableSettings,
  setShowTakebackSettings,
  setShowHordeSetup,
  setShowResistancePicker,
}: {
  takeback: Pick<TakebackStatus, 'mode'>;
  onlineTable: OnlineTable | null;
  horde: SoloHordeState | null;
  resistanceLevel: ResistanceLevel;
  setShowTableSettings: (open: boolean) => void;
  setShowTakebackSettings: (open: boolean) => void;
  setShowHordeSetup: (open: boolean) => void;
  setShowResistancePicker: (open: boolean) => void;
}): SettingLink[] {
  return [
    {
      label: 'Takeback rule',
      value: TAKEBACK_MODE_LABEL[takeback.mode],
      onOpen: () => {
        setShowTableSettings(false);
        setShowTakebackSettings(true);
      },
    },
    // Solo Horde (E387 PR 5): hidden at an online table, a horde never
    // exists there.
    ...(!onlineTable
      ? [
          {
            label: 'Horde',
            value: horde
              ? `${horde.config.hordeName} · ${hordeLevelLabel(horde.config.level)}`
              : 'Off',
            onOpen: () => {
              setShowTableSettings(false);
              setShowHordeSetup(true);
            },
          },
        ]
      : []),
    {
      label: 'Resistance',
      value: RESISTANCE_LEVEL_LABEL[resistanceLevel],
      onOpen: () => {
        setShowTableSettings(false);
        setShowResistancePicker(true);
      },
    },
  ];
}

/** Set-and-forget switches, rendered in full in the sheet. The turn alert
 *  only means something where the turn can pass to you from someone else. */
export function buildSettingsToggles({
  snap,
  setSnap,
  turnAlert,
  setTurnAlert,
  onlineTable,
}: {
  snap: boolean;
  setSnap: (on: boolean) => void;
  turnAlert: boolean;
  setTurnAlert: (on: boolean) => void;
  onlineTable: OnlineTable | null;
}): SettingToggle[] {
  return [
    {
      label: 'Snap cards to grid',
      hint: 'Cards you drop line up on a half-card grid.',
      on: snap,
      onChange: (on) => {
        setSnap(on);
        writeSnap(on);
      },
    },
    ...(onlineTable
      ? [
          {
            label: 'Turn alert',
            hint: "Chimes and flags the tab title when it's your turn.",
            on: turnAlert,
            onChange: (on: boolean) => {
              setTurnAlert(on);
              writeTurnAlert(on);
            },
          },
        ]
      : []),
  ];
}

/** What the drawer carries, in the order you reach for it: the things you
 *  open mid-game, the things you set once. */
export function buildGameMenuSections({
  hasUnreadLog,
  handleOpenLog,
  gridFits,
  gridMode,
  toggleLayout,
  myArrowCount,
  clearMyArrows,
  openRules,
  heldDesignations,
  onlineHorde,
  isFullscreen,
  setShowStats,
  setShowDesignations,
  setShowTableSettings,
  setShowShortcuts,
}: {
  hasUnreadLog: boolean;
  handleOpenLog: () => void;
  gridFits: boolean;
  gridMode: boolean;
  toggleLayout: () => void;
  myArrowCount: number;
  clearMyArrows: () => boolean | void;
  openRules: () => void;
  heldDesignations: string[];
  onlineHorde: OnlineHordeResult | null;
  isFullscreen: boolean;
  setShowStats: (open: boolean) => void;
  setShowDesignations: (open: boolean) => void;
  setShowTableSettings: (open: boolean) => void;
  setShowShortcuts: (open: boolean) => void;
}): GameMenuSection[] {
  return [
    {
      title: 'Table',
      items: [
        { label: 'Stats', icon: BarChart3, onClick: () => setShowStats(true) },
        {
          label: 'Log',
          icon: ScrollText,
          note: hasUnreadLog ? 'New' : undefined,
          onClick: handleOpenLog,
        },
        ...(gridFits
          ? [
              {
                label: gridMode ? 'Show the rail' : 'Show the seat grid',
                icon: gridMode ? Rows3 : LayoutGrid,
                onClick: toggleLayout,
              },
            ]
          : []),
        ...(myArrowCount > 0
          ? [
              {
                label: `Clear my arrows (${myArrowCount})`,
                icon: Eraser,
                onClick: () => void clearMyArrows(),
              },
            ]
          : []),
        // The same quick-look reference the live tracker's menu opens — one
        // sheet, mounted once in Layout, so the board just asks for it.
        { label: 'Rules reference', icon: BookOpen, onClick: openRules },
        // Game state that changes hands mid-game when a card resolves, so it
        // sits with the things you open during play, not in the settings.
        {
          label: 'Designations',
          icon: Crown,
          note: heldDesignations.length > 0 ? heldDesignations.join(', ') : undefined,
          onClick: () => setShowDesignations(true),
        },
        ...(onlineHorde
          ? [
              {
                label: "Undo the horde's last step",
                icon: Undo2,
                note: onlineHorde.lastStepLabel ?? undefined,
                disabled: !onlineHorde.lastStepLabel,
                onClick: () => onlineHorde.undoLast(),
              },
            ]
          : []),
      ],
    },
    {
      title: 'Settings',
      items: [
        { label: 'Table settings', icon: Settings, onClick: () => setShowTableSettings(true) },
        { label: 'Keyboard shortcuts', icon: Keyboard, onClick: () => setShowShortcuts(true) },
        // Fullscreen is offered only where the browser offers it (not inside
        // every embedded browser).
        ...(typeof document !== 'undefined' && document.fullscreenEnabled
          ? [
              {
                label: isFullscreen ? 'Exit fullscreen' : 'Fullscreen',
                icon: isFullscreen ? Minimize2 : Maximize2,
                onClick: () => {
                  if (document.fullscreenElement) void document.exitFullscreen();
                  else void document.documentElement.requestFullscreen();
                },
              },
            ]
          : []),
      ],
    },
  ];
}

/** The ones that end a game, kept at the foot of the drawer. */
export function buildGameMenuFooter({
  onBack,
  backLabel,
  onlineTable,
  doReset,
  concedeOnline,
  leaveTable,
  setEndingTable,
}: {
  onBack: (() => void) | undefined;
  backLabel: string | undefined;
  onlineTable: OnlineTable | null;
  doReset: () => Promise<void>;
  concedeOnline: () => Promise<void>;
  leaveTable: () => Promise<void>;
  setEndingTable: (open: boolean) => void;
}): GameMenuSection {
  return {
    title: 'Game',
    items: [
      ...(onBack
        ? [{ label: `Back to ${backLabel ?? 'deck'}`, icon: ArrowLeft, onClick: onBack }]
        : []),
      { label: 'Start a new game', icon: RotateCcw, danger: true, onClick: () => void doReset() },
      ...(onlineTable
        ? [
            { label: 'Concede', icon: Flag, danger: true, onClick: () => void concedeOnline() },
            // Only the host can end the table — the server enforces the same
            // rule, so nobody else is offered a button that would bounce.
            ...(onlineTable.isHost
              ? [
                  {
                    label: 'End the table for everyone',
                    icon: Gavel,
                    danger: true,
                    onClick: () => setEndingTable(true),
                  },
                ]
              : []),
            {
              label: 'Leave the table',
              icon: LogOut,
              danger: true,
              onClick: () => void leaveTable(),
            },
          ]
        : []),
    ],
  };
}

/** EDHPlay's felt menu, row for row, then the ones this table adds. */
export function buildTableMenuItems({
  state,
  onlineTable,
  takeback,
  canPassTurn,
  hordeBlocksTurn,
  manaOpen,
  selectMode,
  keyFor,
  doPassTurn,
  doNextTurnHordeAware,
  doUntapAll,
  setManaOpen,
  setTokenCreator,
  setViewer,
  setShowDice,
  setShowDesignations,
  sendReaction,
  toggleSelectMode,
  handleTakebackClick,
}: {
  state: PlaytestState;
  onlineTable: OnlineTable | null;
  takeback: Pick<TakebackStatus, 'mode' | 'verdict' | 'stepsAvailable'>;
  canPassTurn: boolean;
  hordeBlocksTurn: boolean;
  manaOpen: boolean;
  selectMode: boolean;
  keyFor: (id: ShortcutId) => string | undefined;
  doPassTurn: () => void;
  doNextTurnHordeAware: () => boolean;
  doUntapAll: () => void;
  setManaOpen: (update: (open: boolean) => boolean) => void;
  setTokenCreator: (open: boolean) => void;
  setViewer: (viewer: { zone: 'sideboard' }) => void;
  setShowDice: (open: boolean) => void;
  setShowDesignations: (open: boolean) => void;
  sendReaction: (index: number) => void;
  toggleSelectMode: () => void;
  handleTakebackClick: () => void;
}): MenuEntry[] {
  // Takeback's glance cue: the count, a lock, or "Off". Read by the table
  // menu's own row, so it is resolved before that list is built.
  const takebackBadge =
    takeback.mode === 'off'
      ? 'Off'
      : takeback.verdict === 'locked'
        ? 'Locked'
        : takeback.stepsAvailable > 0
          ? String(takeback.stepsAvailable)
          : null;

  return [
    canPassTurn
      ? { label: 'Pass turn', shortcut: keyFor('pass-turn'), onClick: doPassTurn }
      : {
          label: 'Next turn',
          // Solo, Space is the next turn too (EDHPlay's key for this row);
          // online and not your turn it does nothing, so Shift+N is the key.
          shortcut: keyFor(onlineTable ? 'next-turn' : 'pass-turn'),
          onClick: doNextTurnHordeAware,
          disabled: hordeBlocksTurn,
        },
    { label: 'Untap all', shortcut: keyFor('untap-all'), onClick: doUntapAll },
    {
      label: manaOpen ? 'Hide mana pool' : 'Show mana pool',
      shortcut: keyFor('mana'),
      onClick: () => setManaOpen((open) => !open),
    },
    { label: 'Create token', shortcut: keyFor('token'), onClick: () => setTokenCreator(true) },
    // Cards outside the game (Wishes, Karn, Learn, companions). A menu row
    // rather than a pile: most decks have no sideboard and the rest reach
    // for it once a game, so it only appears while there is one to open.
    ...(state.zones.sideboard.length > 0
      ? [{ label: 'View sideboard', onClick: () => setViewer({ zone: 'sideboard' as const }) }]
      : []),
    {
      label: 'Roll dice or flip a coin',
      shortcut: keyFor('dice'),
      onClick: () => setShowDice(true),
    },
    { label: 'Designations', onClick: () => setShowDesignations(true) },
    ...(onlineTable
      ? [
          {
            label: 'Reactions',
            // The four with keys first, as their keys run (7 to 0).
            items: REACTION_EMOTES.map((emote, i) => ({
              label: `${emote} ${REACTION_LABEL[emote]}`,
              shortcut: i < 4 ? keyFor(`react-${i + 1}` as ShortcutId) : undefined,
              onClick: () => sendReaction(i),
            })),
          },
        ]
      : []),
    SEPARATOR,
    { label: selectMode ? 'Done selecting' : 'Select cards', onClick: toggleSelectMode },
    {
      label: takebackBadge ? `Take back (${takebackBadge})` : 'Take back',
      shortcut: keyFor('undo'),
      onClick: handleTakebackClick,
      disabled: takeback.mode === 'off' || takeback.verdict === 'none',
    },
  ];
}
