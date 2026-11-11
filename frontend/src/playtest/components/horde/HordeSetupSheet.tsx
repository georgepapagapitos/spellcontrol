import { useState, useRef } from 'react';
import { Sheet, type SheetHandle } from '@/components/overlays/Sheet';
// `HordeSetupFields` reuses the Local setup form's `Stepper`/`RulePill`
// (`.play-stepper`/`.play-rule-pill`) — an explicit import so the playtest
// page chunks that mount this sheet actually load that stylesheet too (see
// css-chunk-ownership.test.ts).
import '@/styles/play-setup.css';
import { HordeSetupFields } from '@/components/play/horde/HordeSetupFields';
import { findBannedCards } from '@/lib/horde/ban-list';
import type { HordeLevel, HordeSettings } from '@/lib/horde';
import { usePlaytestStore } from '@/playtest/store';
import type { SoloHordeState } from '@/playtest/lib/horde-solo';
import './HordeSetupSheet.css';
import { Button } from '@/components/shared/Button';

interface Props {
  horde: SoloHordeState | null;
  hordeLoad: {
    status: 'idle' | 'loading' | 'error';
    error: string | null;
  };
  cardNames: readonly string[];
  resistanceOn: boolean;
  onClose(): void;
}

/**
 * "Fight a horde" (STYLE_GUIDE "Horde table" setup, solo'd): the paper
 * table's own `HordeSetupFields` for one survivor, in a bottom sheet on
 * phones / a centered dialog at >=1024px. Opens on the current fight's
 * settings when one is already armed, offering "Stop the fight" instead of
 * just Cancel there.
 */
export function HordeSetupSheet({ horde, hordeLoad, cardNames, resistanceOn, onClose }: Props) {
  const sheetRef = useRef<SheetHandle>(null);
  const armHorde = usePlaytestStore((s) => s.armHorde);
  const disarmHorde = usePlaytestStore((s) => s.disarmHorde);
  const retryHordeLoad = usePlaytestStore((s) => s.retryHordeLoad);

  const [hordeId, setHordeId] = useState(horde?.config.hordeId ?? 'zombies');
  const [level, setLevel] = useState<HordeLevel>(horde?.config.level ?? 'standard');
  const [customiseOpen, setCustomiseOpen] = useState(false);
  const [overrides, setOverrides] = useState<Partial<HordeSettings>>(horde?.config.overrides ?? {});

  const warnings = findBannedCards([{ name: 'Your deck', cardNames }]);

  async function fight() {
    await armHorde(hordeId, level, overrides);
    if (usePlaytestStore.getState().hordeLoad.status !== 'error') sheetRef.current?.close();
  }

  return (
    <Sheet
      ref={sheetRef}
      inPlace
      onClose={onClose}
      className="horde-setup-sheet"
      title="Fight a horde"
      toolbar={
        <>
          <p className="horde-setup-sheet__intro">
            A deck that plays itself and attacks you each turn. Damage you deal mills its library.
          </p>
          {resistanceOn && <p className="horde-setup-sheet__exclusive">Turns Resistance off.</p>}
        </>
      }
      footer={(close) => (
        <>
          {horde && (
            <Button
              onClick={() => {
                disarmHorde();
                close();
              }}
            >
              Stop the fight
            </Button>
          )}
          <Button onClick={() => close()}>Cancel</Button>
          <Button
            variant="primary"
            disabled={hordeLoad.status === 'loading'}
            onClick={() => void fight()}
          >
            {hordeLoad.status === 'loading' ? 'Fighting the horde…' : 'Fight the horde'}
          </Button>
        </>
      )}
    >
      <div className="horde-setup-sheet__body">
        <HordeSetupFields
          hordeId={hordeId}
          onHordeChange={setHordeId}
          level={level}
          onLevelChange={setLevel}
          survivorCount={1}
          customiseOpen={customiseOpen}
          onToggleCustomise={() => setCustomiseOpen((o) => !o)}
          overrides={overrides}
          onOverridesChange={setOverrides}
          warnings={warnings}
        />
        {hordeLoad.status === 'error' && (
          <p className="horde-setup-sheet__error" role="alert">
            {hordeLoad.error ?? "Couldn't load that horde."}{' '}
            <Button onClick={() => retryHordeLoad()}>Retry</Button>
          </p>
        )}
      </div>
    </Sheet>
  );
}
