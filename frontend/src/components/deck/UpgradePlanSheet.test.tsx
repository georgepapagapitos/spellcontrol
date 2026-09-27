// @vitest-environment happy-dom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UpgradePlanSheet, type UpgradePlanSheetProps } from './UpgradePlanSheet';
import type { Change } from '@/lib/deck-change';
import type { UpgradePlanTools } from '@/lib/upgrade-plan-tools';

vi.mock('@/lib/card-thumbs', () => ({ useCardThumb: () => undefined }));
const carouselOpen = vi.fn();
vi.mock('./useCardCarousel', () => ({
  useCardCarousel: () => ({ open: carouselOpen, preview: null }),
}));

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
const cut = (name: string): Change => ({
  id: `cut:${name}`,
  type: 'cut',
  lane: 'upgrade',
  name,
  inclusion: 0,
});

const tools: UpgradePlanTools = {
  estimate: 2,
  current: 2,
  gameChangersInDeck: 0,
  isGameChanger: (n) => n === 'Cyclonic Rift',
  raisesBracket: (c) => c.name === 'Cyclonic Rift',
  estimateAfter: (adds) => (adds.includes('Cyclonic Rift') ? 3 : 2),
  weakestCuts: [],
  bracketReason: (c) => (c.name === 'Cyclonic Rift' ? 'Game Changer' : 'Raises the bracket'),
  basics: 10,
  fetchers: 0,
};

function props(over: Partial<UpgradePlanSheetProps> = {}): UpgradePlanSheetProps {
  return {
    deckId: 'd1',
    moves: [
      add('Cyclonic Rift'),
      add('Threats Around Every Corner'),
      add('Harrow', { ownership: 'owned', role: 'ramp' }),
      add('Abhorrent Oculus'),
      add('Hauntwoods Shrieker'),
      add('Breeding Pool'),
    ],
    cuts: [
      cut('Kefnet the Mindful'),
      cut('Skaab Ruinator'),
      cut('Kianne'),
      cut('Body of Knowledge'),
      cut('Rashmi'),
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
const button = (name: string | RegExp) => screen.getByRole('button', { name });

describe('UpgradePlanSheet', () => {
  beforeEach(() => {
    priceState.loaded = true;
    media.wide = true;
    carouselOpen.mockClear();
    localStorage.clear();
  });

  it('splits what the budget buys from what the collection gives free', () => {
    render(<UpgradePlanSheet {...props()} />);
    // Harrow fills a short role for free; the rest by value for money.
    expect(planRows()).toEqual([
      'Harrow',
      'Threats Around Every Corner',
      'Hauntwoods Shrieker',
      'Abhorrent Oculus',
    ]);
    expect(screen.getByText('$13.57')).toBeTruthy();
    expect(screen.getByText(/of \$50 · 3 cards/)).toBeTruthy();
    expect(screen.getByText('1 card')).toBeTruthy();
    expect(screen.getByText('free, no budget used')).toBeTruthy();
    expect(screen.getByText('Stays Bracket 2 · Core')).toBeTruthy();
    expect(screen.getByText('Ramp 10 → 11')).toBeTruthy();
    expect(screen.getByText(/Replaces Kefnet the Mindful/)).toBeTruthy();
  });

  it('says why money is left over', () => {
    render(<UpgradePlanSheet {...props()} />);
    expect(screen.getByText('Nothing else worth buying fits the $36.43 left.')).toBeTruthy();
  });

  it('opens the card coming in and the card going out', () => {
    render(<UpgradePlanSheet {...props()} />);
    fireEvent.click(button('Preview Abhorrent Oculus'));
    expect(carouselOpen).toHaveBeenLastCalledWith(expect.any(Array), 'Abhorrent Oculus');
    fireEvent.click(button('Preview Kianne (being cut)'));
    expect(carouselOpen).toHaveBeenLastCalledWith(expect.any(Array), 'Kianne');
    // One carousel walks the whole plan, cuts included.
    const entries = carouselOpen.mock.calls[0][0] as Array<{ name: string }>;
    expect(entries.map((e) => e.name)).toContain('Kefnet the Mindful');
  });

  it('keeps a card the plan wanted to cut, and gives it back', () => {
    render(<UpgradePlanSheet {...props()} />);
    fireEvent.click(button('Keep Kefnet the Mindful'));
    expect(
      screen.getByText('Kept Kefnet the Mindful. Harrow replaces Skaab Ruinator instead.')
    ).toBeTruthy();
    const kept = screen.getByRole('region', { name: 'Kept in the deck' });
    fireEvent.click(within(kept).getByRole('button', { name: 'Let the plan cut it' }));
    expect(screen.queryByRole('region', { name: 'Kept in the deck' })).toBeNull();
    expect(screen.getByText(/Replaces Kefnet the Mindful/)).toBeTruthy();
  });

  it('lists every left-out card with its own reason', () => {
    render(<UpgradePlanSheet {...props()} />);
    // At $100 the Game Changer would fit, so holding the bracket names it.
    fireEvent.click(screen.getByRole('radio', { name: '$100' }));
    const list = screen.getByText('Left out').closest('details')!;
    expect(list.textContent).toContain('Cyclonic Rift');
    expect(list.textContent).toContain('Game Changer. Moves the deck past Bracket 2.');
    expect(list.textContent).toContain('Breeding Pool');
    expect(list.textContent).toContain('No price today.');
    fireEvent.click(within(list).getByRole('button', { name: 'Preview Cyclonic Rift' }));
    expect(carouselOpen).toHaveBeenLastCalledWith(expect.any(Array), 'Cyclonic Rift');
  });

  it('moves up a bracket from the left-out list, Game Changers first', () => {
    render(<UpgradePlanSheet {...props()} />);
    fireEvent.click(screen.getByRole('radio', { name: '$100' }));
    fireEvent.click(button('Plan for Bracket 3'));
    expect(
      (screen.getByRole('radio', { name: /Move up to Bracket 3/ }) as HTMLInputElement).checked
    ).toBe(true);
    expect(planRows()[0]).toBe('Cyclonic Rift');
    expect(screen.getByText('Bracket 2 · Core → Bracket 3 · Upgraded')).toBeTruthy();
  });

  it('re-plans when a row is unticked and names what took its place', () => {
    render(<UpgradePlanSheet {...props({ cuts: [cut('A'), cut('B'), cut('C')] })} />);
    expect(planRows()).not.toContain('Abhorrent Oculus');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include Hauntwoods Shrieker' }));
    expect(
      screen.getByText(/Left out Hauntwoods Shrieker\. Abhorrent Oculus takes its place\./)
    ).toBeTruthy();
    const dropped = screen.getByRole('region', { name: 'Left out by you' });
    fireEvent.click(within(dropped).getByRole('checkbox', { name: 'Include Hauntwoods Shrieker' }));
    expect(planRows()).toContain('Hauntwoods Shrieker');
  });

  it('applies the plan in place or to a copy', async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    render(<UpgradePlanSheet {...props({ onApply })} />);
    fireEvent.click(button('Apply 4 swaps'));
    expect(onApply).toHaveBeenLastCalledWith(
      [
        { addName: 'Harrow', cutName: 'Kefnet the Mindful' },
        { addName: 'Threats Around Every Corner', cutName: 'Skaab Ruinator' },
        { addName: 'Hauntwoods Shrieker', cutName: 'Kianne' },
        { addName: 'Abhorrent Oculus', cutName: 'Body of Knowledge' },
      ],
      false
    );
    const copy = button('Apply to a copy') as HTMLButtonElement;
    expect(copy.disabled).toBe(true);
    await vi.waitFor(() => expect(copy.disabled).toBe(false));
    fireEvent.click(copy);
    expect(onApply).toHaveBeenLastCalledWith(expect.any(Array), true);
  });

  it('copies the cards to buy, not the owned ones', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<UpgradePlanSheet {...props()} />);
    fireEvent.click(button('Copy shopping list'));
    await vi.waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        '1 Threats Around Every Corner\n1 Hauntwoods Shrieker\n1 Abhorrent Oculus'
      )
    );
  });

  it('says when nothing fits and offers the collection', () => {
    render(<UpgradePlanSheet {...props()} />);
    fireEvent.click(screen.getByRole('switch', { name: /Use cards I own/ }));
    fireEvent.click(screen.getByRole('radio', { name: 'Custom amount' }));
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '0' } });
    expect(screen.getByText('Nothing fits $0.')).toBeTruthy();
    fireEvent.click(button('Use cards I own'));
    expect(planRows()).toEqual(['Harrow']);
  });

  it('remembers the budget and goal for the deck', () => {
    const { unmount } = render(<UpgradePlanSheet {...props()} />);
    fireEvent.click(screen.getByRole('radio', { name: '$100' }));
    fireEvent.click(screen.getByRole('radio', { name: /Any bracket/ }));
    unmount();
    render(<UpgradePlanSheet {...props()} />);
    expect((screen.getByRole('radio', { name: '$100' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: /Any bracket/ }) as HTMLInputElement).checked).toBe(
      true
    );
  });

  it('waits for the analysis and the prices before planning', () => {
    const { rerender } = render(<UpgradePlanSheet {...props({ analysisState: 'pending' })} />);
    expect((button(/^Apply \d+ swaps?$/) as HTMLButtonElement).disabled).toBe(true);
    expect(planRows()).toEqual([]);
    priceState.loaded = false;
    rerender(<UpgradePlanSheet {...props()} />);
    expect(planRows()).toEqual([]);
  });

  it('folds the settings into one row and the extra actions into a menu on a phone', () => {
    media.wide = false;
    render(<UpgradePlanSheet {...props()} />);
    expect(button(/Settings/).textContent).toContain('$50 · Stay at Bracket 2 · Cards I own');
    expect(screen.queryByRole('button', { name: 'Apply to a copy' })).toBeNull();
    expect(button('More plan actions')).toBeTruthy();
  });

  it('holds Bracket 4 without leaving out Game Changers, and cannot move up', () => {
    render(
      <UpgradePlanSheet
        {...props({ tools: { ...tools, estimate: 4, current: 4, estimateAfter: () => 4 } })}
      />
    );
    fireEvent.click(screen.getByRole('radio', { name: '$100' }));
    expect(planRows()).toContain('Cyclonic Rift');
    expect(screen.getByText('Left out').closest('details')!.textContent).not.toContain(
      'Cyclonic Rift'
    );
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

  it('rewrites a land swap moved onto another cut, dropping the old reason', () => {
    const swap = add('Breeding Pool', {
      type: 'swap',
      lane: 'lands',
      inName: 'Tapland',
      role: 'land',
      deltaScore: 30,
      ownership: 'owned',
      reason: 'Adds green fixing, over Tapland.',
    });
    const land = (name: string): Change => ({ ...cut(name), typeLine: 'Land' });
    render(
      <UpgradePlanSheet
        {...props({ moves: [swap], cuts: [land('Tapland'), land('Other Tapland')] })}
      />
    );
    expect(screen.getByText('Adds green fixing, over Tapland.')).toBeTruthy();
    fireEvent.click(button('Keep Tapland'));
    expect(screen.getByText('Replaces Other Tapland')).toBeTruthy();
    expect(screen.queryByText(/over Tapland/)).toBeNull();
    expect(button('Preview Other Tapland (being cut)')).toBeTruthy();
  });

  it('closes from the header', () => {
    const onClose = vi.fn();
    render(<UpgradePlanSheet {...props({ onClose })} />);
    fireEvent.click(button('Close'));
    expect(onClose).toHaveBeenCalled();
  });
});
