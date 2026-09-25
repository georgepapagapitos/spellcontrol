// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PlaytestCard } from '@/lib/playtest';
import { HordeRevealSheet } from './HordeRevealSheet';

const CARDS: PlaytestCard[] = [
  { id: 'a', name: 'Zombie', isToken: true },
  { id: 'b', name: 'Zombie Giant', isToken: true },
  { id: 'c', name: 'Bad Moon' },
  { id: 'd', name: 'Plague Wind', typeLine: 'Sorcery' },
];

describe('HordeRevealSheet', () => {
  it('lists the revealed cards left to right in reveal order, each captioned with its position', () => {
    render(
      <HordeRevealSheet
        revealed={CARDS}
        toResolveIds={new Set(['d'])}
        waveEndId="c"
        onConfirm={vi.fn()}
      />
    );
    const captions = screen
      .getAllByText(/^\d+ ·/)
      .map((el) => el.textContent?.replace(/\s+/g, ' ').trim());
    expect(captions).toEqual([
      '1 · Zombie',
      '2 · Zombie Giant',
      '3 · ends the wave',
      '4 · Plague Wind',
    ]);
  });

  it('outlines the wave-ending card', () => {
    render(
      <HordeRevealSheet
        revealed={CARDS}
        toResolveIds={new Set()}
        waveEndId="c"
        onConfirm={vi.fn()}
      />
    );
    const cards = document.querySelectorAll('.horde-reveal-card');
    expect(cards[2].classList.contains('is-wave-end')).toBe(true);
    expect(cards[0].classList.contains('is-wave-end')).toBe(false);
  });

  it('names the spell to resolve before confirming', () => {
    render(
      <HordeRevealSheet
        revealed={CARDS}
        toResolveIds={new Set(['d'])}
        waveEndId="c"
        onConfirm={vi.fn()}
      />
    );
    expect(
      screen.getByText(/The horde casts Plague Wind\. Resolve it, then confirm\./)
    ).toBeTruthy();
  });
});
