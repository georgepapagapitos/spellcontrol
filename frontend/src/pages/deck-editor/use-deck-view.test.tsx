// @vitest-environment happy-dom
import type { ReactNode } from 'react';
import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useDeckView } from './use-deck-view';

const setup = (url: string) => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
  );
  return renderHook(() => ({ v: useDeckView(), loc: useLocation() }), { wrapper });
};

describe('useDeckView', () => {
  it('defaults to the deck view with the dialogs closed', () => {
    const { result } = setup('/decks/d1');
    expect(result.current.v.view).toBe('deck');
    expect(result.current.v.exportOpen).toBe(false);
    expect(result.current.v.planOpen).toBe(false);
    expect(result.current.v.arrivalsDeepLink).toBe(false);
  });

  it('reads the active view from the URL', () => {
    expect(setup('/decks/d1?view=power').result.current.v.view).toBe('power');
  });

  it('writes a tab switch to the URL, and the default tab clears the param', () => {
    const { result } = setup('/decks/d1');
    act(() => result.current.v.setView('tune'));
    expect(result.current.v.view).toBe('tune');
    expect(result.current.loc.search).toBe('?view=tune');
    act(() => result.current.v.setView('deck'));
    expect(result.current.v.view).toBe('deck');
    expect(result.current.loc.search).toBe('');
  });

  it('opens a one-shot deep link, then strips the params so a refresh does not reopen it', () => {
    const { result } = setup('/decks/d1?view=tune&export=1&plan=1&arrivals=1');
    expect(result.current.v.exportOpen).toBe(true);
    expect(result.current.v.planOpen).toBe(true);
    expect(result.current.v.arrivalsDeepLink).toBe(true);
    expect(result.current.loc.search).toBe('?view=tune');
  });

  it('lets the dialogs be closed again after a deep link', () => {
    const { result } = setup('/decks/d1?export=1');
    act(() => result.current.v.setExportOpen(false));
    expect(result.current.v.exportOpen).toBe(false);
  });

  it('a combos next-best-move switches to the Power tab without a coach focus', () => {
    const { result } = setup('/decks/d1');
    act(() => result.current.v.handleNbmNavigate('power', 'combos'));
    expect(result.current.v.view).toBe('power');
    expect(result.current.v.tuneFocusLane).toBeNull();
  });

  it('hands a Tune intent lane to the coach feed until it is cleared', () => {
    const { result } = setup('/decks/d1');
    act(() => result.current.v.handleNavigateToTune('lands'));
    expect(result.current.v.view).toBe('tune');
    expect(result.current.v.tuneFocusLane).toBe('lands');
    act(() => result.current.v.clearTuneFocus());
    expect(result.current.v.tuneFocusLane).toBeNull();
  });
});
