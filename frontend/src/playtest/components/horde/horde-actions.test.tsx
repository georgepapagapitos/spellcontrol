// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePlaytestStore } from '@/playtest/store';
import { HordeActionsProvider, useHordeActions, type HordeActions } from './horde-actions';

describe('useHordeActions', () => {
  it('falls back to the solo playtest store when no provider is above it', () => {
    const resolveHordeAttack = vi.fn();
    const damageHorde = vi.fn();
    const moveHordeCard = vi.fn();
    const confirmHordeReveal = vi.fn();
    const clearHordeDamageResult = vi.fn();
    const retryHordeLoad = vi.fn();
    usePlaytestStore.setState({
      resolveHordeAttack,
      damageHorde,
      moveHordeCard,
      confirmHordeReveal,
      clearHordeDamageResult,
      retryHordeLoad,
    });

    const { result } = renderHook(() => useHordeActions());
    result.current.take(5);
    result.current.damage(3, null);
    result.current.move('card1', 'exile');
    result.current.confirmReveal(null);
    result.current.clearDamageResult();
    result.current.retryLoad();

    expect(resolveHordeAttack).toHaveBeenCalledWith(5);
    expect(damageHorde).toHaveBeenCalledWith(3, null);
    expect(moveHordeCard).toHaveBeenCalledWith('card1', 'exile');
    expect(confirmHordeReveal).toHaveBeenCalledWith(null);
    expect(clearHordeDamageResult).toHaveBeenCalledTimes(1);
    expect(retryHordeLoad).toHaveBeenCalledTimes(1);
  });

  it('uses the provided value instead, when one is above it', () => {
    const provided: HordeActions = {
      take: vi.fn(),
      damage: vi.fn(),
      move: vi.fn(),
      confirmReveal: vi.fn(),
      clearDamageResult: vi.fn(),
      retryLoad: vi.fn(),
    };
    const { result } = renderHook(() => useHordeActions(), {
      wrapper: ({ children }) => (
        <HordeActionsProvider value={provided}>{children}</HordeActionsProvider>
      ),
    });
    result.current.take(9);
    expect(provided.take).toHaveBeenCalledWith(9);
  });
});
