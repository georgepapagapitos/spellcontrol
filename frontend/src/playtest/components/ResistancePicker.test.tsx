// @vitest-environment happy-dom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ResistancePicker } from './ResistancePicker';
import { DEFAULT_RESISTANCE_OPTIONS, type ResistanceOptions } from '../lib/resistance';

function setup(
  props: Partial<{
    level: 'off' | 'casual' | 'standard' | 'ruthless';
    options: ResistanceOptions;
    bracket: number | null;
  }> = {}
) {
  const onSave = vi.fn();
  render(
    <ResistancePicker
      level={props.level ?? 'off'}
      options={props.options ?? DEFAULT_RESISTANCE_OPTIONS}
      bracket={props.bracket === undefined ? 3 : props.bracket}
      onSave={onSave}
      onClose={() => {}}
    />
  );
  return { onSave };
}

const levels = () => within(screen.getByRole('group', { name: 'Difficulty' }));

describe('ResistancePicker (E533)', () => {
  it("tags the level that fits the deck's bracket", () => {
    setup({ bracket: 4 });
    const ruthless = levels().getByRole('radio', { name: /Ruthless/ });
    expect(ruthless.closest('label')?.textContent).toContain('Fits bracket 4');
    expect(screen.getAllByText(/Fits bracket/)).toHaveLength(1);
  });

  it('with no bracket, tags the last level used instead', () => {
    localStorage.setItem('spellcontrol:playtest:resistance-level', 'casual');
    setup({ bracket: null });
    expect(screen.queryByText(/Fits bracket/)).toBeNull();
    expect(
      levels()
        .getByRole('radio', { name: /Casual/ })
        .closest('label')?.textContent
    ).toContain('Last used');
  });

  it('hides timing and answers while Off, and shows them with their values once on', () => {
    setup({ level: 'off' });
    expect(screen.queryByRole('button', { name: /Timing/ })).toBeNull();
    fireEvent.click(levels().getByRole('radio', { name: /Standard/ }));
    expect(screen.getByRole('button', { name: /Timing/ }).textContent).toContain('From turn 3');
    expect(screen.getByRole('button', { name: /Answers/ }).textContent).toContain('All 6');
  });

  it('picking a level is a draft: nothing is saved until Save', () => {
    const { onSave } = setup({ level: 'off' });
    fireEvent.click(levels().getByRole('radio', { name: /Ruthless/ }));
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith('ruthless', DEFAULT_RESISTANCE_OPTIONS);
  });

  it('saves timing and answer changes', () => {
    const { onSave } = setup({ level: 'standard' });
    fireEvent.click(screen.getByRole('button', { name: /Timing/ }));
    fireEvent.click(screen.getByRole('radio', { name: '5' }));
    fireEvent.click(screen.getByRole('button', { name: /Answers/ }));
    fireEvent.click(screen.getByRole('switch', { name: 'Discard' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Game Changers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith('standard', {
      firstTurn: 5,
      effects: { ...DEFAULT_RESISTANCE_OPTIONS.effects, discard: false },
      gameChangers: true,
    });
  });

  it('with every answer off, warns and offers to turn them all back on', () => {
    setup({ level: 'standard' });
    fireEvent.click(screen.getByRole('button', { name: /Answers/ }));
    for (const name of ['Counterspells', 'Removal', 'Bounce', 'Board wipes', 'Attacks', 'Discard'])
      fireEvent.click(screen.getByRole('switch', { name }));
    expect(screen.getByText('With every answer off, nobody does anything.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Turn all on' }));
    expect(screen.queryByText('With every answer off, nobody does anything.')).toBeNull();
    expect(screen.getByRole('switch', { name: 'Discard' }).getAttribute('aria-checked')).toBe(
      'true'
    );
  });

  it('Cancel saves nothing', () => {
    const { onSave } = setup({ level: 'standard' });
    fireEvent.click(levels().getByRole('radio', { name: /Casual/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSave).not.toHaveBeenCalled();
  });
});
