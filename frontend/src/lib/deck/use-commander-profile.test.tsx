// @vitest-environment happy-dom
/**
 * One voltron answer on every screen (E1002 follow-up). The profile hook reads the commander's
 * EDHREC themes only if a surface already cached the page, so it never adds a request:
 * text-only until the page lands, then the Voltron veto (golden.md R11) applies.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  VETOED_COMMANDERS,
  vetoedCard,
  vetoedPage,
} from '@/deck-builder/services/deckBuilder/__fixtures__/vetoed-commanders';
import { useCommanderProfile } from './use-commander-profile';

const isVoltron = (p: ReturnType<typeof useCommanderProfile>) =>
  !!p?.abilities.some((a) => a.keyword === 'voltron');

describe('useCommanderProfile', () => {
  it('reads voltron from the text until the page is cached, then drops it', () => {
    const name = VETOED_COMMANDERS[0];
    const { result } = renderHook(() => useCommanderProfile(vetoedCard(name)));
    expect(isVoltron(result.current)).toBe(true);
    act(() => void vetoedPage(name));
    expect(isVoltron(result.current)).toBe(false);
  });

  it.each(VETOED_COMMANDERS.slice(1))('%s is not voltron once its page is cached', (name) => {
    const card = vetoedCard(name);
    expect(isVoltron(renderHook(() => useCommanderProfile(card)).result.current)).toBe(true);
    vetoedPage(name);
    expect(isVoltron(renderHook(() => useCommanderProfile(card)).result.current)).toBe(false);
  });

  it('is null without a commander and makes no request', () => {
    expect(renderHook(() => useCommanderProfile(null)).result.current).toBeNull();
  });
});
