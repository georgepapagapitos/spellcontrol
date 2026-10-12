import { writeFelt } from '../../lib/table-skin';
import type { Deck } from '@/store/decks';
import type { PlaytestAction, PlaytestState } from '@/lib/playtest';
import { effectiveBracket } from '@/store/decks';
import type { OnlineTable } from '../../hooks/use-online-table';
import type { TakebackStatus } from '../../hooks/use-takeback';
import type { ResistanceLevel } from '../../lib/resistance';
import type { ResistanceOptions } from '../../lib/resistance';
import type { ShortcutOverrides } from '../../lib/shortcuts';

import { CustomCountersDialog } from '../CustomCountersDialog';
import { DesignationsPicker } from '../DesignationsPicker';
import { ResistancePicker } from '../ResistancePicker';
import { ShortcutsSheet } from '../ShortcutsSheet';
import { TakebackModePicker } from '../TakebackModePicker';
import { TableSettingsSheet, type SettingLink, type SettingToggle } from '../TableSettingsSheet';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from '../../lib/board-support';

interface BoardSettingsSheetsProps {
  state: PlaytestState;
  dispatch: (action: PlaytestAction) => void;
  deck: Deck | undefined;
  onlineTable: OnlineTable | null;
  takeback: TakebackStatus;
  isNarrow: boolean;
  // Table settings.
  showTableSettings: boolean;
  setShowTableSettings: (open: boolean) => void;
  zoom: number;
  setZoomTo: (value: number) => void;
  felt: string;
  setFelt: (id: string) => void;
  settingsToggles: SettingToggle[];
  settingsLinks: SettingLink[];
  // Keyboard shortcuts.
  showShortcuts: boolean;
  setShowShortcuts: (open: boolean) => void;
  shortcutOverrides: ShortcutOverrides;
  changeShortcuts: (next: ShortcutOverrides) => void;
  // Resistance.
  showResistancePicker: boolean;
  setShowResistancePicker: (open: boolean) => void;
  resistanceLevel: ResistanceLevel;
  setResistanceLevel: (level: ResistanceLevel) => void;
  resistanceOptions: ResistanceOptions;
  setResistanceOptions: (options: ResistanceOptions) => void;
  // Custom counters, designations, takeback rule.
  countersBf: PlaytestState['battlefield'][number] | undefined;
  setCountersFor: (cardId: string | null) => void;
  showDesignations: boolean;
  setShowDesignations: (open: boolean) => void;
  handleSetDesignation: (
    designation: Parameters<
      NonNullable<React.ComponentProps<typeof DesignationsPicker>['onSet']>
    >[0],
    held: boolean
  ) => void;
  showTakebackSettings: boolean;
  setShowTakebackSettings: (open: boolean) => void;
}

/** The set-and-forget sheets: table settings, the keyboard map, resistance,
 *  custom counters, designations and the takeback rule. */
export function BoardSettingsSheets({
  state,
  dispatch,
  deck,
  onlineTable,
  takeback,
  isNarrow,
  showTableSettings,
  setShowTableSettings,
  zoom,
  setZoomTo,
  felt,
  setFelt,
  settingsToggles,
  settingsLinks,
  showShortcuts,
  setShowShortcuts,
  shortcutOverrides,
  changeShortcuts,
  showResistancePicker,
  setShowResistancePicker,
  resistanceLevel,
  setResistanceLevel,
  resistanceOptions,
  setResistanceOptions,
  countersBf,
  setCountersFor,
  showDesignations,
  setShowDesignations,
  handleSetDesignation,
  showTakebackSettings,
  setShowTakebackSettings,
}: BoardSettingsSheetsProps) {
  return (
    <>
      {showTableSettings && (
        <TableSettingsSheet
          // Every tier has a size to set (user, 2026-09-25: permanents read
          // small on a phone). Below 1024px the hand keeps its own size, so
          // the hint names only what follows.
          zoom={{
            value: zoom,
            min: ZOOM_MIN,
            max: ZOOM_MAX,
            step: ZOOM_STEP,
            hint: isNarrow ? 'Your hand keeps its own size.' : 'The = and − keys step it too.',
            onZoom: setZoomTo,
          }}
          skin={{
            felt,
            onFelt: (id) => {
              setFelt(id);
              writeFelt(id);
            },
          }}
          toggles={settingsToggles}
          links={settingsLinks}
          onClose={() => setShowTableSettings(false)}
        />
      )}
      {showShortcuts && (
        <ShortcutsSheet
          overrides={shortcutOverrides}
          onChange={changeShortcuts}
          onClose={() => setShowShortcuts(false)}
        />
      )}

      {showResistancePicker && (
        <ResistancePicker
          level={resistanceLevel}
          options={resistanceOptions}
          bracket={deck ? (effectiveBracket(deck) ?? null) : null}
          onSave={(level, options) => {
            // Options first: re-arming at a new level reads them from the
            // store, and a level that didn't change keeps its opponent.
            setResistanceOptions(options);
            if (level !== resistanceLevel) setResistanceLevel(level);
          }}
          onClose={() => setShowResistancePicker(false)}
        />
      )}

      {countersBf && (
        <CustomCountersDialog
          cardName={countersBf.card.name}
          counters={countersBf.counters}
          onApply={(deltas) => {
            for (const [counter, delta] of Object.entries(deltas))
              dispatch({ type: 'SET_COUNTER', cardId: countersBf.card.id, counter, delta });
            setCountersFor(null);
          }}
          onClose={() => setCountersFor(null)}
        />
      )}

      {showDesignations && (
        <DesignationsPicker
          monarch={state.monarch}
          initiative={state.initiative}
          citysBlessing={state.citysBlessing}
          onSet={handleSetDesignation}
          onClose={() => setShowDesignations(false)}
        />
      )}

      {showTakebackSettings && (
        <TakebackModePicker
          mode={takeback.mode}
          onSelect={takeback.setMode}
          onClose={() => setShowTakebackSettings(false)}
          online={onlineTable !== null}
        />
      )}
    </>
  );
}
