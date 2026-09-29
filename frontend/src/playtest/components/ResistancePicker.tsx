import { useState } from 'react';
import './ResistancePicker.css';
import { useLockBodyScroll } from '@/lib/use-lock-body-scroll';
import { useSheetExit } from '@/lib/use-sheet-exit';
import {
  ChoiceList,
  Disclosure,
  Field,
  SegmentedControl,
  SwitchRow,
} from '@/components/shared/form';
import {
  FIRST_TURN_CHOICES,
  levelForBracket,
  loadLastResistanceLevel,
  RESISTANCE_EFFECT_COPY,
  RESISTANCE_EFFECTS,
  RESISTANCE_LEVELS,
  RESISTANCE_LEVEL_DESCRIPTION,
  RESISTANCE_LEVEL_LABEL,
  summarizeEffects,
  type ResistanceEffect,
  type ResistanceLevel,
  type ResistanceOptions,
} from '../lib/resistance';
import { Button } from '@/components/shared/Button';

interface Props {
  level: ResistanceLevel;
  options: ResistanceOptions;
  /** The deck's bracket (stated, else estimated), or null when unknown. Tags
   *  the level that fits it. */
  bracket: number | null;
  onSave(level: ResistanceLevel, options: ResistanceOptions): void;
  onClose(): void;
}

const ALL_ON = Object.fromEntries(RESISTANCE_EFFECTS.map((e) => [e, true])) as Record<
  ResistanceEffect,
  boolean
>;

/**
 * Resistance setup (E142, E533). The level is the main job and always open;
 * while it's on, timing and answers sit in two `Disclosure` rows that state
 * their value, since most people keep the defaults (STYLE_GUIDE § Config
 * surfaces). Edits are a draft until Save, so trying levels doesn't re-arm
 * the opponent or write a log line per tap.
 */
export function ResistancePicker({ level, options, bracket, onSave, onClose }: Props) {
  const { isClosing, beginClose, onAnimationEnd } = useSheetExit(onClose, 'binder-sheet-slide-out');
  useLockBodyScroll();
  const [lastUsed] = useState(loadLastResistanceLevel);
  const [draftLevel, setDraftLevel] = useState(level);
  const [draft, setDraft] = useState(options);

  const fits = levelForBracket(bracket);
  const noAnswers = RESISTANCE_EFFECTS.every((e) => !draft.effects[e]);

  function tagFor(l: ResistanceLevel): string | null {
    if (fits !== null) return l === fits ? `Fits bracket ${bracket}` : null;
    return level === 'off' && l === lastUsed ? 'Last used' : null;
  }

  function setEffect(effect: ResistanceEffect, on: boolean) {
    setDraft((d) => ({ ...d, effects: { ...d.effects, [effect]: on } }));
  }

  function save() {
    onSave(draftLevel, draft);
    beginClose();
  }

  const gameChangersHint =
    bracket !== null && bracket < 3
      ? `Cyclonic Rift, Force of Will and Fierce Guardianship. Off by default at bracket ${bracket}.`
      : 'Cyclonic Rift, Force of Will and Fierce Guardianship. Off by default below bracket 3.';

  return (
    <div className="card-picker-root">
      {/* The backdrop fully covers the root (both `inset: 0`), so it — not
          root — is what a "click outside the sheet" actually lands on. */}
      <div className="card-picker-backdrop" role="presentation" onClick={() => beginClose()} />
      <div
        className={`card-picker-sheet playtest-resistance-picker${isClosing ? ' is-closing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="resistance-picker-title"
        onAnimationEnd={onAnimationEnd}
      >
        <div className="card-picker-handle" aria-hidden />
        <div className="card-picker-header">
          <h2 id="resistance-picker-title" className="card-picker-title">
            Resistance
          </h2>
          <p className="playtest-resistance-picker__intro">
            Simulated opponents answer your plays, so you see how the deck holds up at a real table.
          </p>
        </div>
        <div className="playtest-resistance-picker__body">
          <ChoiceList
            ariaLabel="Difficulty"
            value={draftLevel}
            onChange={setDraftLevel}
            options={RESISTANCE_LEVELS.map((l) => {
              const tag = tagFor(l);
              return {
                value: l,
                label: (
                  <>
                    {RESISTANCE_LEVEL_LABEL[l]}
                    {tag && <span className="playtest-resistance-picker__tag">{tag}</span>}
                  </>
                ),
                hint: RESISTANCE_LEVEL_DESCRIPTION[l],
              };
            })}
          />

          {draftLevel !== 'off' && (
            <div className="playtest-resistance-picker__groups">
              <Disclosure title="Timing" summary={`From turn ${draft.firstTurn}`}>
                <Field
                  label="First answer on turn"
                  hint="Nothing happens before this turn. Few tables have an answer up on turns 1 and 2."
                >
                  <SegmentedControl
                    ariaLabel="First answer on turn"
                    fill
                    value={draft.firstTurn}
                    onChange={(firstTurn) => setDraft((d) => ({ ...d, firstTurn }))}
                    options={FIRST_TURN_CHOICES.map((t) => ({ value: t, label: String(t) }))}
                  />
                </Field>
              </Disclosure>

              <Disclosure
                title="Answers"
                summary={`${summarizeEffects(draft.effects)}${draft.gameChangers ? ' · Game Changers' : ''}`}
              >
                <div className="playtest-resistance-picker__switches">
                  {RESISTANCE_EFFECTS.map((e) => (
                    <SwitchRow
                      key={e}
                      label={RESISTANCE_EFFECT_COPY[e].label}
                      hint={RESISTANCE_EFFECT_COPY[e].hint}
                      checked={draft.effects[e]}
                      onChange={(on) => setEffect(e, on)}
                    />
                  ))}
                  <SwitchRow
                    label="Game Changers"
                    hint={gameChangersHint}
                    checked={draft.gameChangers}
                    onChange={(gameChangers) => setDraft((d) => ({ ...d, gameChangers }))}
                  />
                </div>
                {noAnswers && (
                  <div className="playtest-resistance-picker__warning" role="status">
                    <span>With every answer off, nobody does anything.</span>
                    <Button onClick={() => setDraft((d) => ({ ...d, effects: ALL_ON }))}>
                      Turn all on
                    </Button>
                  </div>
                )}
              </Disclosure>
            </div>
          )}
        </div>
        <div className="card-picker-footer">
          <Button onClick={() => beginClose()}>Cancel</Button>
          <Button variant="primary" onClick={save}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
