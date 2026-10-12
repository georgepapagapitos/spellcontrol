// @vitest-environment happy-dom
/**
 * "What your collection leans toward" (E284): the leans read from the cards
 * alone, nothing is fetched until the disclosure opens, and each lean has its
 * own loading, empty, no-page and error states.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useCallback, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReadinessScore } from '@/lib/deck/commander-readiness';
import type { EnrichedCard } from '@/types/index';

const { fetchTagPageData } = vi.hoisted(() => ({ fetchTagPageData: vi.fn() }));
vi.mock('@/deck-builder/services/edhrec/client', () => ({ fetchTagPageData }));
vi.mock('@/lib/cards/card-thumbs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/cards/card-thumbs')>()),
  useCardThumb: () => undefined,
}));

import { CommanderLeans } from './CommanderLeans';

function card(name: string, text: string): EnrichedCard {
  return {
    copyId: name,
    name,
    scryfallId: name,
    setCode: 'tst',
    setName: 'Test',
    collectorNumber: '1',
    rarity: 'common',
    purchasePrice: 0,
    sourceCategory: '',
    sourceFormat: '',
    finish: 'nonfoil',
    foil: false,
    typeLine: 'Creature',
    oracleText: text,
    colorIdentity: ['W'],
  } as EnrichedCard;
}

// 12 of 32 white cards make creature tokens; nothing else leans.
const WHITE = [
  ...Array.from({ length: 20 }, (_, i) => card(`Filler ${i}`, 'Flying')),
  ...Array.from({ length: 12 }, (_, i) =>
    card(`Maker ${i}`, 'Create a 1/1 white Soldier creature token.')
  ),
];
const BLUE_PAD = Array.from({ length: 30 }, (_, i) => ({
  ...card(`Blue ${i}`, 'Flying'),
  colorIdentity: ['U'],
}));

const score = (percent: number): ReadinessScore => ({
  available: true,
  ownedCount: percent,
  totalCount: 100,
  percent,
  explainerLine: `${percent} of 100 staples owned`,
  ownedSamples: [],
});
const SCORES: Record<string, ReadinessScore> = {
  'Mid Commander': score(40),
  'Top Commander': score(75),
  'Zero Commander': score(0),
};
const commander = (name: string, rank: number) => ({
  rank,
  name,
  sanitized: name.toLowerCase().replace(/ /g, '-'),
  colorIdentity: [],
  numDecks: 1000 - rank,
});
const page = (colorSlug: string | null, names: string[]) => ({
  commanders: names.map((n, i) => commander(n, i + 1)),
  cardlists: {},
  potentialDecks: 0,
  highSynergyNames: [],
  colorSlug,
});

function Harness({
  cards = [...WHITE, ...BLUE_PAD],
  colors = new Set<string>(),
  onPick = () => {},
}: {
  cards?: EnrichedCard[];
  colors?: Set<string>;
  onPick?: (name: string) => void;
}) {
  const [readiness, setReadiness] = useState<Map<string, ReadinessScore | 'loading'>>(new Map());
  const ensureReadiness = useCallback(async (name: string) => {
    setReadiness((prev) => new Map(prev).set(name.toLowerCase(), SCORES[name] ?? score(10)));
  }, []);
  return (
    <CommanderLeans
      cards={cards}
      colors={colors}
      readiness={readiness}
      ensureReadiness={ensureReadiness}
      isOwned={(n) => n === 'Top Commander'}
      selectingName={null}
      onPick={onPick}
    />
  );
}

const open = () => fireEvent.click(screen.getByRole('button', { name: /leans toward/i }));

describe('CommanderLeans', () => {
  beforeEach(() => {
    fetchTagPageData.mockReset();
  });

  it('says what the collection leans toward without fetching anything', () => {
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: /leans toward/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toContain('White tokens');
    expect(fetchTagPageData).not.toHaveBeenCalled();
  });

  it('renders nothing when no color leans', () => {
    const { container } = render(<Harness cards={BLUE_PAD} />);
    expect(container.innerHTML).toBe('');
  });

  it('hides a lean the color filter excludes', () => {
    const { container } = render(<Harness colors={new Set(['B'])} />);
    expect(container.innerHTML).toBe('');
  });

  it('fetches only the lean page, in its color, when opened, and ranks by coverage', async () => {
    fetchTagPageData.mockResolvedValue(
      page('mono-white', ['Mid Commander', 'Top Commander', 'Zero Commander'])
    );
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    open();
    expect(screen.getByRole('status').textContent).toBe('Finding white tokens commanders…');
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(2));
    expect(fetchTagPageData).toHaveBeenCalledTimes(1);
    expect(fetchTagPageData).toHaveBeenCalledWith('tokens', ['W']);
    expect(screen.getByRole('heading', { name: 'White tokens' })).toBeTruthy();
    const names = screen
      .getAllByRole('listitem')
      .map((li) => /Top Commander|Mid Commander/.exec(li.textContent ?? '')?.[0]);
    expect(names).toEqual(['Top Commander', 'Mid Commander']);
    expect(screen.queryByText(/Zero Commander/)).toBeNull();
  });

  it('says so when no commander on the page shares cards with the collection', async () => {
    fetchTagPageData.mockResolvedValue(page('mono-white', ['Zero Commander']));
    render(<Harness />);
    open();
    expect(await screen.findByText(/share cards with your collection yet/)).toBeTruthy();
  });

  it('says so when EDHREC has no page in that color', async () => {
    fetchTagPageData.mockResolvedValue(page(null, ['Top Commander']));
    render(<Harness />);
    open();
    expect(await screen.findByText(/EDHREC has no white page for Tokens/)).toBeTruthy();
  });

  it('reports a failed fetch with a Retry that tries again', async () => {
    fetchTagPageData.mockRejectedValueOnce(new Error('down'));
    fetchTagPageData.mockResolvedValueOnce(page('mono-white', ['Top Commander']));
    render(<Harness />);
    open();
    expect((await screen.findByRole('alert')).textContent).toContain(
      "Couldn't reach EDHREC for white tokens"
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    expect(fetchTagPageData).toHaveBeenCalledTimes(2);
  });

  it('picks a commander by name', async () => {
    fetchTagPageData.mockResolvedValue(page('mono-white', ['Top Commander']));
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    open();
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: /Top Commander/ }));
    expect(onPick).toHaveBeenCalledWith('Top Commander');
  });
});
