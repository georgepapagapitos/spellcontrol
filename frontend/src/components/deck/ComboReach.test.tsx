// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { toClockLibrary } from '@/lib/mana-sim/hand-classify';
import { drawCard } from '@/lib/mana-sim/__fixtures__/draw-cards';
import type { ReachPlan } from '@/lib/mana-sim/combo-reach';
import { ComboReach, ComboReachAny } from './ComboReach';

const library = (() => {
  const cards = [
    drawCard("Thassa's Oracle"),
    drawCard('Demonic Consultation'),
    drawCard('Demonic Tutor'),
  ];
  for (let i = 0; i < 18; i++) cards.push(drawCard('Island'));
  for (let i = 0; i < 18; i++) cards.push(drawCard('Swamp'));
  while (cards.length < 99) cards.push(drawCard('Counterspell'));
  return toClockLibrary(cards);
})();

const timed: ReachPlan = {
  kind: 'timed',
  option: { names: ["Thassa's Oracle", 'Demonic Consultation'], need: 2 },
};

/** An observer that reports the row on screen at once, or never. */
function stubObserver(onScreen: boolean): void {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(private cb: (e: { isIntersecting: boolean }[]) => void) {}
      observe(): void {
        if (onScreen) this.cb([{ isIntersecting: true }]);
      }
      disconnect(): void {}
    }
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('ComboReach', () => {
  it('does nothing until the row has been on screen', () => {
    stubObserver(false);
    const onSeen = vi.fn();
    const { container } = render(
      <ComboReach plan={timed} library={library} tutors={[]} onSeen={onSeen} />
    );
    expect(onSeen).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(container.querySelector('.combo-reach-scope')?.textContent?.trim()).toBe('');
  });

  it('holds its place until the run lands, then reads turns 6, 8 and 10 with the games behind them', async () => {
    stubObserver(true);
    const onSeen = vi.fn();
    const { container, rerender } = render(
      <ComboReach plan={timed} library={null} tutors={['Demonic Tutor']} onSeen={onSeen} />
    );
    // Seen, but the panel has not built the library yet: placeholders of the same shape.
    expect(onSeen).toHaveBeenCalled();
    expect(container.querySelectorAll('.combo-reach-bar')).toHaveLength(3);
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();

    rerender(
      <ComboReach plan={timed} library={library} tutors={['Demonic Tutor']} onSeen={onSeen} />
    );
    await waitFor(() => expect(container.querySelector('[aria-busy="false"]')).toBeTruthy(), {
      timeout: 20000,
    });
    expect(container.querySelectorAll('.combo-reach-bar')).toHaveLength(3);
    expect(screen.getByText('T6')).toBeTruthy();
    expect(screen.getByText('T10')).toBeTruthy();
    expect(screen.getByText(/1,000 games, 1 tutor counted as extra outs/)).toBeTruthy();
    expect(screen.getByLabelText(/^Turn 10: \d+%, 95% range \d+ to \d+$/)).toBeTruthy();
  }, 30000);

  it('says why a combo is not timed, and shows nothing for a command-zone-only one', () => {
    const { container, rerender } = render(
      <ComboReach
        plan={{ kind: 'untimed', reason: 'sideboard' }}
        library={null}
        tutors={[]}
        onSeen={() => {}}
      />
    );
    expect(screen.getByText('Not timed: one piece is in the sideboard.')).toBeTruthy();
    rerender(<ComboReach plan={{ kind: 'none' }} library={null} tutors={[]} onSeen={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('ComboReachAny', () => {
  it('needs two combos to be a redundancy figure', () => {
    const { container } = render(
      <ComboReachAny
        options={[timed.option as never]}
        library={null}
        tutors={[]}
        onSeen={() => {}}
      />
    );
    expect(container.firstChild).toBeNull();
  });
});
