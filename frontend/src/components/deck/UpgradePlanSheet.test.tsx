// @vitest-environment happy-dom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UpgradePlanSheet, type UpgradePlanSheetProps } from './UpgradePlanSheet';
import type { Change } from '@/lib/deck-change';
import type { UpgradePlanTools } from '@/lib/upgrade-plan-tools';

vi.mock('@/lib/card-thumbs', () => ({ useCardThumb: () => undefined }));

const PRICES: Record<string, number> = {
  'threats around every corner': 0.34,
  'abhorrent oculus': 11.97,
  'cyclonic rift': 39.16,
  'hauntwoods shrieker': 1.26,
};
const priceState = { loaded: true };
vi.mock('./use-missing-prices', () => ({
  useCardPriceLookup: () => ({
    prices: new Map(Object.entries(PRICES)),
    loaded: priceState.loaded,
  }),
}));
const media = { wide: true };
vi.mock('@/lib/use-media-query', () => ({ useMediaQuery: () => media.wide }));

const add = (name: string, extra: Partial<Change> = {}): Change => ({
  id: `fill-gaps:${name}`,
  type: 'add',
  lane: 'fill-gaps',
  name,
  ownership: 'unowned',
  inclusion: 50,
  ...extra,
});
const cut = (name: string): Change => ({ id: `cut:${name}`, type: 'cut', lane: 'upgrade', name });

const tools: UpgradePlanTools = {
  estimate: 2,
  current: 2,
  gameChangersInDeck: 0,
  isGameChanger: (n) => n === 'Cyclonic Rift',
  raisesBracket: (c) => c.name === 'Cyclonic Rift',
  estimateAfter: (adds) => (adds.includes('Cyclonic Rift') ? 3 : 2),
  weakestCuts: [],
};

function props(over: Partial<UpgradePlanSheetProps> = {}): UpgradePlanSheetProps {
  return {
    moves: [
      add('Cyclonic Rift'),
      add('Threats Around Every Corner'),
      add('Harrow', { ownership: 'owned', role: 'ramp' }),
      add('Abhorrent Oculus'),
      add('Hauntwoods Shrieker'),
    ],
    cuts: [
      cut('Kefnet the Mindful'),
      cut('Skaab Ruinator'),
      cut('Kianne'),
      cut('Body of Knowledge'),
    ],
    roleCounts: { ramp: 10 },
    roleTargets: { ramp: 12 },
    openSlots: 0,
    tools,
    commanderName: 'Zimone',
    analysisState: 'ready',
    onApply: vi.fn().mockResolvedValue(undefined),
    onClose: vi.fn(),
    ...over,
  };
}

const planRows = () =>
  screen
    .queryAllByRole('checkbox', { checked: true })
    .map((b) => b.getAttribute('aria-label')?.replace('Include ', ''));

describe('UpgradePlanSheet', () => {
  beforeEach(() => {
    priceState.loaded = true;
    media.wide = true;
  });

  it('plans within the budget, owned copies free, and holds the bracket', () => {
    render(<UpgradePlanSheet {...props()} />);
    expect(planRows()).toEqual([
      'Harrow',
      'Threats Around Every Corner',
      'Abhorrent Oculus',
      'Hauntwoods Shrieker',
    ]);
    expect(
      (screen.getByRole('button', { name: 'Apply 4 swaps' }) as HTMLButtonElement).disabled
    ).toBe(false);
    expect(screen.getByText('$13.57')).toBeTruthy();
    expect(screen.getByText('Stays Bracket 2 · Core')).toBeTruthy();
    expect(
      screen.getByText(/Left out Cyclonic Rift\. It moves the deck up a bracket\./)
    ).toBeTruthy();
    expect(screen.getByText('Ramp 10 → 11')).toBeTruthy();
    // Each swap row names its cut.
    expect(screen.getByText(/Replaces Kefnet the Mindful/)).toBeTruthy();
  });

  it('moves up a bracket from the note, Game Changers first', () => {
    render(<UpgradePlanSheet {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Plan for Bracket 3' }));
    expect(
      (screen.getByRole('radio', { name: /Move up to Bracket 3/ }) as HTMLInputElement).checked
    ).toBe(true);
    expect(planRows()[0]).toBe('Cyclonic Rift');
    expect(screen.getByText('Bracket 2 · Core → Bracket 3 · Upgraded')).toBeTruthy();
    expect(screen.getByText('Game Changer')).toBeTruthy();
  });

  it('re-plans when a row is unticked and names what took its place', () => {
    render(<UpgradePlanSheet {...props({ cuts: [cut('A'), cut('B'), cut('C')] })} />);
    // Three cuts: Oculus takes the last one and Shrieker has nowhere to go.
    expect(planRows()).not.toContain('Hauntwoods Shrieker');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include Abhorrent Oculus' }));
    expect(screen.getByRole('status').textContent).toContain(
      'Left out Abhorrent Oculus. Hauntwoods Shrieker takes its place.'
    );
    expect(planRows()).toContain('Hauntwoods Shrieker');
    const dropped = screen.getByRole('region', { name: 'Left out by you' });
    fireEvent.click(within(dropped).getByRole('checkbox', { name: 'Include Abhorrent Oculus' }));
    expect(planRows()).toContain('Abhorrent Oculus');
  });

  it('applies the plan in place or to a copy', async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    render(<UpgradePlanSheet {...props({ onApply })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Apply 4 swaps' }));
    expect(onApply).toHaveBeenLastCalledWith(
      [
        // Rank order, not the grouped display order.
        { addName: 'Threats Around Every Corner', cutName: 'Kefnet the Mindful' },
        { addName: 'Harrow', cutName: 'Skaab Ruinator' },
        { addName: 'Abhorrent Oculus', cutName: 'Kianne' },
        { addName: 'Hauntwoods Shrieker', cutName: 'Body of Knowledge' },
      ],
      false
    );
    // Both applies stay disabled until the first one settles.
    const copy = screen.getByRole('button', { name: 'Apply to a copy' }) as HTMLButtonElement;
    expect(copy.disabled).toBe(true);
    await vi.waitFor(() => expect(copy.disabled).toBe(false));
    fireEvent.click(copy);
    expect(onApply).toHaveBeenLastCalledWith(expect.any(Array), true);
  });

  it('copies the cards to buy, not the owned ones', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<UpgradePlanSheet {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy shopping list' }));
    await vi.waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        '1 Threats Around Every Corner\n1 Abhorrent Oculus\n1 Hauntwoods Shrieker'
      )
    );
  });

  it('says when nothing fits and offers the collection', () => {
    render(<UpgradePlanSheet {...props()} />);
    fireEvent.click(screen.getByRole('switch', { name: /Use my cards first/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'Custom amount' }));
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '0' } });
    expect(screen.getByText('Nothing fits $0.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use my cards first' }));
    expect(planRows()).toEqual(['Harrow']);
  });

  it('waits for the analysis and the prices before planning', () => {
    const { rerender } = render(<UpgradePlanSheet {...props({ analysisState: 'pending' })} />);
    expect(
      (screen.getByRole('button', { name: /^Apply \d+ swaps?$/ }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(planRows()).toEqual([]);
    priceState.loaded = false;
    rerender(<UpgradePlanSheet {...props()} />);
    expect(planRows()).toEqual([]);
  });

  it('folds the settings into one row and the extra actions into a menu on a phone', () => {
    media.wide = false;
    render(<UpgradePlanSheet {...props()} />);
    expect(screen.getByRole('button', { name: /Settings/ }).textContent).toContain(
      '$50 · Stay at Bracket 2 · Your cards first'
    );
    expect(screen.queryByRole('button', { name: 'Apply to a copy' })).toBeNull();
    expect(screen.getByRole('button', { name: 'More plan actions' })).toBeTruthy();
  });

  it('holds Bracket 4 without leaving out Game Changers, and cannot move up', () => {
    render(
      <UpgradePlanSheet
        {...props({ tools: { ...tools, estimate: 4, current: 4, estimateAfter: () => 4 } })}
      />
    );
    expect(planRows()).toContain('Cyclonic Rift');
    expect(screen.queryByText(/Left out Cyclonic Rift/)).toBeNull();
    const up = screen.getByRole('radio', { name: /Move up a bracket/ }) as HTMLInputElement;
    expect(up.disabled).toBe(true);
    expect(screen.getByText('Bracket 4 is the highest a plan builds to.')).toBeTruthy();
  });

  it("reaches past the feed's cuts into the deck's weakest cards", () => {
    const weakestCuts = [cut('Body of Knowledge'), cut('Weak One'), cut('Weak Two')];
    render(
      <UpgradePlanSheet
        {...props({ cuts: [cut('Kefnet the Mindful')], tools: { ...tools, weakestCuts } })}
      />
    );
    expect(planRows()).toHaveLength(4);
    expect(screen.getByText(/Replaces Weak Two/)).toBeTruthy();
  });

  it('closes from the header', () => {
    const onClose = vi.fn();
    render(<UpgradePlanSheet {...props({ onClose })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});
