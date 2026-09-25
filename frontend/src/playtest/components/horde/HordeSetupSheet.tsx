import { useState } from 'react';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { useEscapeKey } from '@/lib/use-escape-key';
import { useSheetExit } from '@/lib/use-sheet-exit';
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
 * phones / a centred dialog at >=1024px. Opens on the current fight's
 * settings when one is already armed, offering "Stop the fight" instead of
 * just Cancel there.
 */
export function HordeSetupSheet({ horde, hordeLoad, cardNames, resistanceOn, onClose }: Props) {
  const armHorde = usePlaytestStore((s) => s.armHorde);
  const disarmHorde = usePlaytestStore((s) => s.disarmHorde);
  const retryHordeLoad = usePlaytestStore((s) => s.retryHordeLoad);
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose);
  useLockBodyScroll();
  useEscapeKey(() => beginClose());

  const [hordeId, setHordeId] = useState(horde?.config.hordeId ?? 'zombies');
  const [level, setLevel] = useState<HordeLevel>(horde?.config.level ?? 'standard');
  const [customiseOpen, setCustomiseOpen] = useState(false);
  const [overrides, setOverrides] = useState<Partial<HordeSettings>>(horde?.config.overrides ?? {});

  const warnings = findBannedCards([{ name: 'Your deck', cardNames }]);

  async function fight() {
    await armHorde(hordeId, level, overrides);
    if (usePlaytestStore.getState().hordeLoad.status !== 'error') beginClose();
  }

  return (
    <div className="card-picker-root">
      <div className="card-picker-backdrop" role="presentation" onClick={() => beginClose()} />
      <div
        className={`card-picker-sheet horde-setup-sheet${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Fight a horde"
        onAnimationEnd={onAnimationEnd}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <h2 className="card-picker-title">Fight a horde</h2>
          <p className="horde-setup-sheet__intro">
            A deck that plays itself. Each turn it reveals cards until a nontoken card, and
            everything it controls attacks you. Damage you deal it mills its library.
          </p>
          {resistanceOn && <p className="horde-setup-sheet__exclusive">Turns Resistance off.</p>}
        </div>
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
              <button type="button" className="btn" onClick={() => retryHordeLoad()}>
                Try again
              </button>
            </p>
          )}
        </div>
        <div className="card-picker-footer">
          {horde && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                disarmHorde();
                beginClose();
              }}
            >
              Stop the fight
            </button>
          )}
          <button type="button" className="btn" onClick={() => beginClose()}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={hordeLoad.status === 'loading'}
            onClick={() => void fight()}
          >
            {hordeLoad.status === 'loading' ? 'Fighting the horde…' : 'Fight the horde'}
          </button>
        </div>
      </div>
    </div>
  );
}
