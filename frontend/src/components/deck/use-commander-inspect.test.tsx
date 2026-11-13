// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { CarouselEntry } from './useCardCarousel';

type GetActions = (e: CarouselEntry, i: number) => { key: string; onClick: () => void }[];
const carousel = vi.hoisted(() => ({
  open: vi.fn(),
  getActions: null as null | GetActions,
}));
vi.mock('./useCardCarousel', () => ({
  useCardCarousel: (_title: string, getActions: GetActions) => {
    carousel.getActions = getActions;
    return { open: carousel.open, preview: null };
  },
}));

import { useCommanderInspect } from './use-commander-inspect';

const entries = [
  { name: 'Queen Marchesa', numDecks: 4200 },
  { name: 'Krenko, Mob Boss', numDecks: 31000 },
];

describe('useCommanderInspect', () => {
  it('opens the preview on the tapped commander, every tile on screen swipeable', () => {
    const { result } = renderHook(() => useCommanderInspect(entries, vi.fn()));
    result.current.open('Krenko, Mob Boss');
    expect(carousel.open).toHaveBeenCalledWith(
      [
        { name: 'Queen Marchesa', label: '4.2k decks' },
        { name: 'Krenko, Mob Boss', label: '31k decks' },
      ],
      'Krenko, Mob Boss'
    );
  });

  it('Choose commander in the preview picks the commander shown', () => {
    const onChoose = vi.fn();
    renderHook(() => useCommanderInspect(entries, onChoose));
    const actions = carousel.getActions!({ name: 'Queen Marchesa', label: '' }, 0);
    expect(actions.map((a) => a.key)).toEqual(['choose']);
    actions[0].onClick();
    expect(onChoose).toHaveBeenCalledWith(entries[0]);
  });
});
