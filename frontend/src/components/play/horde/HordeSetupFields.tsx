import { Check } from 'lucide-react';
import { SelectMenu } from '../../SelectMenu';
import { RulePill, Stepper } from '../SetupControls';
import { HordeTile } from './HordeTile';
import {
  DEFAULT_WAVE_PATTERN,
  HORDE_CATALOG,
  resolveHordeSettings,
  type HordeLevel,
  type HordeSettings,
  type RevealMode,
} from '@/lib/horde';
import type { HordeBanWarning } from '@/lib/horde/ban-list';
import './horde-setup.css';

const LEVELS: HordeLevel[] = ['casual', 'standard', 'brutal'];
const LEVEL_LABEL: Record<HordeLevel, string> = {
  casual: 'Casual',
  standard: 'Standard',
  brutal: 'Brutal',
};

function levelSummary(s: HordeSettings): string {
  const bosses =
    s.bossTicks.length > 0
      ? `${s.bossTicks.length} boss${s.bossTicks.length === 1 ? '' : 'es'}`
      : 'no bosses';
  return `${s.life} shared life · ${s.librarySize}-card horde · ${s.setupTurns} setup turns · ${bosses}`;
}

type RevealChoice = 'until-nontoken' | 'waves' | 'waves-pattern' | 'fixed';

function revealChoice(mode: RevealMode): RevealChoice {
  return mode.kind;
}

function revealModeFor(choice: RevealChoice): RevealMode {
  switch (choice) {
    case 'waves':
      return { kind: 'waves', perTurn: 2 };
    case 'waves-pattern':
      return { kind: 'waves-pattern', pattern: DEFAULT_WAVE_PATTERN };
    case 'fixed':
      return { kind: 'fixed', count: 2 };
    case 'until-nontoken':
    default:
      return { kind: 'until-nontoken' };
  }
}

const REVEAL_OPTIONS: { value: RevealChoice; label: string }[] = [
  { value: 'until-nontoken', label: 'Until a nontoken card' },
  { value: 'waves', label: 'Two waves a turn' },
  { value: 'waves-pattern', label: 'Waves 1, 2, 3, 2' },
  { value: 'fixed', label: 'Reveal two cards' },
];

interface Props {
  hordeId: string;
  onHordeChange(id: string): void;
  level: HordeLevel;
  onLevelChange(level: HordeLevel): void;
  survivorCount: number;
  customiseOpen: boolean;
  onToggleCustomise(): void;
  overrides: Partial<HordeSettings>;
  onOverridesChange(next: Partial<HordeSettings>): void;
  warnings: HordeBanWarning[];
}

/**
 * The Horde branch of the Local setup form's Game + Rules sections (design
 * point 1): pick a horde, a difficulty, then the Customise disclosure and the
 * ban-list warning. Pure/controlled — LocalSetup owns every value so
 * `buildSetup`-equivalent stays a single source of truth.
 */
export function HordeSetupFields({
  hordeId,
  onHordeChange,
  level,
  onLevelChange,
  survivorCount,
  customiseOpen,
  onToggleCustomise,
  overrides,
  onOverridesChange,
  warnings,
}: Props) {
  const horde = HORDE_CATALOG.find((h) => h.id === hordeId) ?? HORDE_CATALOG[0];
  const effective = resolveHordeSettings(level, survivorCount, overrides);

  function patch(next: Partial<HordeSettings>) {
    onOverridesChange({ ...overrides, ...next });
  }

  return (
    <>
      <ul className="horde-tile-grid" aria-label="Choose a horde">
        {HORDE_CATALOG.map((h) => (
          <HordeTile
            key={h.id}
            horde={h}
            selected={h.id === hordeId}
            onSelect={() => onHordeChange(h.id)}
          />
        ))}
      </ul>
      <p className="horde-special-rule">{horde.specialRule}</p>

      <fieldset className="horde-difficulty" aria-label="Difficulty">
        {LEVELS.map((l) => {
          const settings = resolveHordeSettings(l, survivorCount);
          const active = l === level;
          return (
            <label key={l} className={`horde-difficulty-row${active ? ' is-active' : ''}`}>
              <input
                type="radio"
                name="horde-level"
                checked={active}
                onChange={() => onLevelChange(l)}
              />
              <span className="horde-difficulty-row-text">
                <span className="horde-difficulty-row-label">{LEVEL_LABEL[l]}</span>
                <span className="horde-difficulty-row-desc">{levelSummary(settings)}</span>
              </span>
              {active && (
                <Check
                  className="horde-difficulty-row-check"
                  aria-hidden
                  width={18}
                  height={18}
                  strokeWidth={2.5}
                />
              )}
            </label>
          );
        })}
      </fieldset>

      <details className="horde-customise" open={customiseOpen}>
        <summary
          className="horde-customise-summary"
          onClick={(e) => {
            e.preventDefault();
            onToggleCustomise();
          }}
        >
          Customise
        </summary>
        {customiseOpen && (
          <div className="horde-customise-body">
            <div className="horde-customise-row">
              <span id="horde-life-label">Shared life</span>
              <Stepper
                value={effective.life}
                min={10}
                max={300}
                step={5}
                ariaLabelledBy="horde-life-label"
                onChange={(v) => patch({ life: v })}
              />
            </div>
            <div className="horde-customise-row">
              <span id="horde-library-label">Horde library</span>
              <Stepper
                value={effective.librarySize}
                min={20}
                max={200}
                step={5}
                ariaLabelledBy="horde-library-label"
                onChange={(v) => patch({ librarySize: v })}
              />
            </div>
            <div className="horde-customise-row">
              <span id="horde-setup-turns-label">Setup turns</span>
              <Stepper
                value={effective.setupTurns}
                min={0}
                max={6}
                step={1}
                ariaLabelledBy="horde-setup-turns-label"
                onChange={(v) => patch({ setupTurns: v })}
              />
            </div>
            <div className="horde-customise-row">
              <span>Reveal rule</span>
              <SelectMenu<RevealChoice>
                ariaLabel="Reveal rule"
                value={revealChoice(effective.reveal)}
                onChange={(v) => patch({ reveal: revealModeFor(v) })}
                options={REVEAL_OPTIONS}
              />
            </div>
            <RulePill
              on={effective.bossTicks.length > 0}
              onChange={(on) =>
                patch({ bossTicks: on ? resolveHordeSettings(level, survivorCount).bossTicks : [] })
              }
              label="Bosses"
              hint="A held-back boss joins the battlefield when the library crosses a tick."
            />
            <RulePill
              on={effective.safeZone !== 'off'}
              onChange={(on) =>
                patch({
                  safeZone: on ? resolveHordeSettings(level, survivorCount).safeZone : 'off',
                })
              }
              label="Safe zone"
              hint="The horde's first cards skip its late-game threats."
            />
          </div>
        )}
      </details>

      {warnings.length > 0 && (
        <div className="horde-ban-warning" role="status">
          {warnings.map((w) => (
            <span key={`${w.seatName}-${w.cardName}`}>
              {w.seatName}: {w.cardName} is on the Horde ban list.
            </span>
          ))}
        </div>
      )}
    </>
  );
}
