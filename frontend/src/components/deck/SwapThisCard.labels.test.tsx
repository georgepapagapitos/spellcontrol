// @vitest-environment happy-dom
import { render, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SwapThisCard } from './SwapThisCard';
import { toSwapAgainst, type Change } from '@/lib/coach/deck-change';
import {
  resetSuggestionLabelsForTests,
  setSuggestionContext,
  setSuggestionLabelsEnabled,
} from '@/lib/util/suggestion-labels';
import type { ScryfallCard } from '@/deck-builder/types';

const sent = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('@/lib/util/analytics', () => ({
  sendBeaconPayload: (p: Record<string, unknown>) => sent.push(p),
  normalizePath: (p: string) => p,
}));

const ATRAXA = '0b0a8d28-1b0f-4d3e-9a3e-5e1a5a7a1f11';

beforeEach(() => {
  sent.length = 0;
  localStorage.clear();
  resetSuggestionLabelsForTests();
  setSuggestionContext({
    id: 'deck-secret-1',
    commander: { name: "Atraxa, Praetors' Voice", oracle_id: ATRAXA } as ScryfallCard,
    partnerCommander: null,
  });
});

const alt = (name: string): Change =>
  toSwapAgainst(
    { id: `fill-gaps:${name}`, type: 'add', lane: 'fill-gaps', name },
    'Rampant Growth'
  );

describe('SwapThisCard suggestion labels', () => {
  it('counts the list once and labels the accepted alternative with its rank', () => {
    const { container, rerender } = render(
      <SwapThisCard
        currentName="Rampant Growth"
        alternatives={[alt('Cultivate'), alt('Kodama’s Reach')]}
        onSwap={vi.fn()}
      />
    );
    rerender(
      <SwapThisCard
        currentName="Rampant Growth"
        alternatives={[alt('Cultivate'), alt('Kodama’s Reach')]}
        onSwap={vi.fn()}
      />
    );
    const buttons = container.querySelectorAll<HTMLButtonElement>('.deck-card-row-act');
    fireEvent.click(buttons[1]);
    expect(sent).toEqual([
      expect.objectContaining({ surface: 'swap-this-card', action: 'shown', n: 2 }),
      expect.objectContaining({
        surface: 'swap-this-card',
        action: 'accept',
        rank: 2,
        reason: 'fill-gaps',
        cmdr: ATRAXA,
        cardIn: 'Kodama’s Reach',
        cardOut: 'Rampant Growth',
      }),
    ]);
  });

  it('sends nothing when the player opted out', () => {
    setSuggestionLabelsEnabled(false);
    const { container } = render(
      <SwapThisCard
        currentName="Rampant Growth"
        alternatives={[alt('Cultivate')]}
        onSwap={vi.fn()}
      />
    );
    fireEvent.click(container.querySelector('.deck-card-row-act') as HTMLButtonElement);
    expect(sent).toEqual([]);
  });
});
