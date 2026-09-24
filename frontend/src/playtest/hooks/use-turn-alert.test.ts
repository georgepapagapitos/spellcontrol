// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { TURN_TITLE_PREFIX, useTurnAlert } from './use-turn-alert';

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('useTurnAlert', () => {
  beforeEach(() => {
    document.title = 'Krenko · SpellControl';
    setHidden(true);
  });
  afterEach(() => setHidden(false));

  it('marks a background tab when the turn passes to you, and clears on return', () => {
    const { rerender } = renderHook(({ mine }) => useTurnAlert(mine, true), {
      initialProps: { mine: false },
    });
    expect(document.title).toBe('Krenko · SpellControl');
    rerender({ mine: true });
    expect(document.title).toBe(`${TURN_TITLE_PREFIX}Krenko · SpellControl`);
    setHidden(false);
    expect(document.title).toBe('Krenko · SpellControl');
  });

  it('stays quiet when you arrive on your own turn', () => {
    renderHook(() => useTurnAlert(true, true));
    expect(document.title).toBe('Krenko · SpellControl');
  });

  it('does nothing while switched off', () => {
    const { rerender } = renderHook(({ mine }) => useTurnAlert(mine, false), {
      initialProps: { mine: false },
    });
    rerender({ mine: true });
    expect(document.title).toBe('Krenko · SpellControl');
  });

  it('leaves no mark behind when the board unmounts', () => {
    const { rerender, unmount } = renderHook(({ mine }) => useTurnAlert(mine, true), {
      initialProps: { mine: false },
    });
    rerender({ mine: true });
    unmount();
    expect(document.title).toBe('Krenko · SpellControl');
  });
});
