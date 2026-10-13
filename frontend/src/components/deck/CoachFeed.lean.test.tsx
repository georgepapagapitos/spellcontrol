// @vitest-environment happy-dom
// E260: "Lean into <theme>" is the FREE lever. It re-orders the feed's rows and
// must never reach the AI refine pool: pool names feed the server's
// `hashRefineInput`, so touching them would silently spend a reading.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CoachFeed, type CoachFeedProps } from './CoachFeed';
import { DeckAiRefine } from './DeckAiRefine';
import { __resetAiStatus } from '@/lib/ai/use-ai-status';
import type { GapAnalysisCard, ScryfallCard } from '@/deck-builder/types';
import type { CommanderProfile } from '@/deck-builder/services/deckBuilder/commanderProfile';
import type { DeckRefinePayload } from '@/lib/ai/ai-refine';

vi.mock('@/lib/cards/card-thumbs', () => ({ useCardThumb: () => undefined }));
vi.mock('./useCardCarousel', () => ({ useCardCarousel: () => ({ open: vi.fn(), preview: null }) }));
vi.mock('./use-deck-hover-peek', () => ({
  useDeckHoverPeek: () => ({ listHandlers: {}, peek: null }),
}));
vi.mock('@/lib/cards/use-tagger-ready', () => ({ useTaggerReady: () => true }));
vi.mock('@/lib/deck-analysis/deck-analysis', () => ({
  analyzeDeck: () => ({ taggerReady: true }),
}));
vi.mock('@/lib/ai/ai-review', async (orig) => ({
  ...(await orig<typeof import('@/lib/ai/ai-review')>()),
  toAiAnalysis: () => ({}),
}));

const LIFEGAIN = new Set(['Essence Warden', 'Vito, Thorn of the Dusk Rose']);
vi.mock('@/deck-builder/services/tagger/client', async (orig) => ({
  ...(await orig<typeof import('@/deck-builder/services/tagger/client')>()),
  hasTag: (name: string, tag: string) => tag === 'lifegain' && LIFEGAIN.has(name),
}));

const refine = vi.fn();
vi.mock('@/lib/ai/ai-refine', async (orig) => ({
  ...(await orig<typeof import('@/lib/ai/ai-refine')>()),
  requestDeckRefine: (payload: DeckRefinePayload) => refine(payload),
}));

const gap = (name: string): GapAnalysisCard =>
  ({ name, role: 'ramp', roleLabel: 'Ramp', inclusion: 60 }) as GapAnalysisCard;

const profile = {
  abilities: [{ keyword: 'lifegain', label: 'Lifegain payoff' }],
  tribes: [],
} as unknown as CommanderProfile;

const POOL = ['Cultivate', 'Essence Warden', 'Kodama’s Reach', 'Vito, Thorn of the Dusk Rose'].map(
  (name) => ({ name, oracleId: '', qty: 1 })
);

function props(over: Partial<CoachFeedProps> = {}): CoachFeedProps {
  return {
    gaps: POOL.map((p) => gap(p.name)),
    synergy: [],
    substitutes: [],
    roleCounts: {},
    roleTargets: {},
    deckSize: 99,
    deckTarget: 99,
    bracketOverridePresent: false,
    resolveOwnership: () => undefined,
    ownedNames: new Set(),
    deckNames: new Set(),
    onApplyMove: vi.fn(),
    onApplyAllDropIns: vi.fn(),
    onConvergeBracket: vi.fn(),
    ownedOnly: false,
    onOwnedOnlyChange: vi.fn(),
    commanderProfile: profile,
    ...over,
  };
}

const rowNames = () =>
  within(screen.getByRole('list', { name: 'Deck suggestions' }))
    .getAllByRole('listitem')
    .map((li) => POOL.find((p) => li.textContent?.includes(p.name))?.name);

describe('CoachFeed lean into', () => {
  it('offers the commander theme the rows serve, labelled free', () => {
    render(<CoachFeed {...props()} />);
    const group = screen.getByRole('group', { name: 'Lean into a theme' });
    expect(within(group).getByRole('button', { name: /Lifegain payoff/ })).toBeTruthy();
    expect(
      screen.getByText(/Free\. Re-orders this list and doesn't use an AI reading/)
    ).toBeTruthy();
  });

  it('offers nothing when no row serves a theme', () => {
    render(<CoachFeed {...props({ commanderProfile: null })} />);
    expect(screen.queryByRole('group', { name: 'Lean into a theme' })).toBeNull();
  });

  it('floats serving rows to the top, names the theme on them, and toggles back', () => {
    render(<CoachFeed {...props()} />);
    const before = rowNames();
    const chip = screen.getByRole('button', { name: /Lifegain payoff/ });
    fireEvent.click(chip);
    const after = rowNames();
    expect(after.slice(0, 2).sort()).toEqual(['Essence Warden', 'Vito, Thorn of the Dusk Rose']);
    expect(after.slice().sort()).toEqual(before.slice().sort());
    expect(screen.getAllByText(/Leans into lifegain payoff/i)).toHaveLength(2);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(chip);
    expect(rowNames()).toEqual(before);
    expect(screen.queryByText(/Leans into lifegain payoff/i)).toBeNull();
  });
});

describe('the lever is free: it cannot change what the AI refine pass sends', () => {
  beforeEach(() => {
    __resetAiStatus();
    localStorage.clear();
    refine.mockReset();
    refine.mockResolvedValue({
      content: 'Fine.',
      tweaks: [],
      cached: true,
      model: 'm',
      usage: { inputTokens: 0, outputTokens: 0 },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('sends a byte-identical refine request with the lever on, and makes no /api/ai call of its own', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ optIn: true, used: 0, limit: 10 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const card = (name: string) => ({ id: name, oracle_id: name, name }) as ScryfallCard;
    const ui = (key: number) => (
      <>
        <CoachFeed {...props()} />
        <DeckAiRefine
          key={key}
          deckId="d1"
          format="commander"
          commander={card('Vito')}
          partnerCommander={null}
          mainboard={[{ slotId: 's1', card: card('Swamp') }]}
          pool={POOL}
          scope="any"
          onApplyMove={() => {}}
        />
      </>
    );
    const view = render(ui(1));

    fireEvent.click(await screen.findByRole('button', { name: 'Refine this build' }));
    await waitFor(() => expect(refine).toHaveBeenCalledTimes(1));
    const callsBeforeLever = fetchMock.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: /Lifegain payoff/ }));
    expect(rowNames().slice(0, 2).sort()).toEqual([
      'Essence Warden',
      'Vito, Thorn of the Dusk Rose',
    ]);
    // Pressing the lever called nothing.
    expect(refine).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.length).toBe(callsBeforeLever);

    // A fresh panel (lever still on) sends the same pool and body.
    view.rerender(ui(2));
    fireEvent.click(await screen.findByRole('button', { name: 'Refine this build' }));
    await waitFor(() => expect(refine).toHaveBeenCalledTimes(2));
    const [first, second] = refine.mock.calls.map((c) => c[0] as DeckRefinePayload);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(second.pool.map((p) => p.name)).toEqual(POOL.map((p) => p.name));
  });
});
