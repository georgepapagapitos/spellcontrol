// @vitest-environment happy-dom
/**
 * F7: the "Save this setup as" field sits inside the local-setup <form>
 * (PlayPage.tsx), so an unhandled Enter there submits the form and starts a
 * game instead of saving — reproduced in a real browser. Enter must save (or
 * do nothing when the name is blank), the same as the Save/Update button,
 * and must never submit the surrounding form.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TableProfiles } from './TableProfiles';
import { usePlayStore, type LocalGameSetup } from '../../store/play';

function setup(): LocalGameSetup {
  return {
    format: 'commander',
    startingLife: 40,
    commanderDamageEnabled: true,
    poisonEnabled: false,
    players: [{ name: 'Alice' }, { name: 'Bo' }] as LocalGameSetup['players'],
  };
}

function renderInForm(onSubmit: () => void) {
  const onLoad = vi.fn();
  render(
    <form onSubmit={(e) => (e.preventDefault(), onSubmit())}>
      <TableProfiles current={setup} onLoad={onLoad} />
    </form>
  );
  return { onLoad };
}

beforeEach(() => {
  usePlayStore.setState({ tableProfiles: [] });
});

describe('TableProfiles — the name field is inside the setup form', () => {
  it('Enter with a name saves the profile and does not submit the form', () => {
    const onSubmit = vi.fn();
    renderInForm(onSubmit);

    const input = screen.getByPlaceholderText('Thursday pod');
    fireEvent.change(input, { target: { value: 'Thursday pod' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(usePlayStore.getState().tableProfiles.map((p) => p.name)).toEqual(['Thursday pod']);
    // The field clears after saving, same as the button.
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('Enter with a blank name does nothing and does not submit', () => {
    const onSubmit = vi.fn();
    renderInForm(onSubmit);

    const input = screen.getByPlaceholderText('Thursday pod');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(usePlayStore.getState().tableProfiles).toHaveLength(0);
  });

  it('Enter on an existing name updates it in place, same as the button', () => {
    usePlayStore.getState().saveTableProfile('Thursday pod', setup());
    const onSubmit = vi.fn();
    renderInForm(onSubmit);

    const input = screen.getByPlaceholderText('Thursday pod');
    fireEvent.change(input, { target: { value: 'Thursday pod' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSubmit).not.toHaveBeenCalled();
    expect(usePlayStore.getState().tableProfiles).toHaveLength(1);
  });
});
