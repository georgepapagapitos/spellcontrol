// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CubeDraftabilityPanel } from './CubeDraftabilityPanel';
import { simulateDraftAsync } from '../../lib/cube/generate-async';
import { COLOR_PAIRS, pairOf } from '../../lib/cube/draft-sim';
import type { DraftSimResult } from '../../lib/cube/draft-sim';
import type { GeneratedCube, Pick } from '../../lib/cube/generate';
import { BUCKET_ORDER } from './shared';
import { pending } from '../../test/pending';

vi.mock('../../lib/cube/generate-async', () => ({
  simulateDraftAsync: vi.fn(),
}));

const mockSimulate = vi.mocked(simulateDraftAsync);

const ZERO_BUCKETS = Object.fromEntries(BUCKET_ORDER.map((b) => [b, 0])) as Record<
  (typeof BUCKET_ORDER)[number],
  number
>;

let id = 0;
function pick(overrides: Partial<Pick['card']> = {}): Pick {
  id += 1;
  return {
    card: {
      name: `Card ${id}`,
      oracleId: `oracle-${id}`,
      colors: ['U'],
      cmc: 2,
      typeLine: 'Creature',
      role: null,
      ...overrides,
    },
    bucket: 'U',
    reason: 'goodstuff',
  };
}

function cubeOf(count: number, size: GeneratedCube['size'] = 360): GeneratedCube {
  const picks = Array.from({ length: count }, () => pick());
  return {
    size,
    format: 'limited',
    picks,
    byBucket: { ...ZERO_BUCKETS, U: count },
    targetByBucket: ZERO_BUCKETS,
    gaps: [],
    shortfall: 0,
    poolSize: count,
  };
}

/** All 10 pairs, sorted descending like `simulateDraft` returns — a couple of
 *  overrides change specific pairs, the rest fill evenly. */
function draftResult(overrides: Partial<DraftSimResult> = {}): DraftSimResult {
  const pairShares = COLOR_PAIRS.map((pair, i) => ({
    pair,
    label: pairOf(pair),
    share: i === 0 ? 0.2 : (1 - 0.2) / (COLOR_PAIRS.length - 1),
  }));
  return {
    runs: 50,
    playersPerRun: 8,
    packsPerPlayer: 3,
    cardsPerPack: 15,
    totalDecks: 400,
    shortCube: false,
    reachedBarShare: 0.96,
    pairShares,
    undraftedArchetypes: [],
    ...overrides,
  };
}

function openToggle() {
  fireEvent.click(screen.getByRole('button', { name: /Draftability/ }));
}

beforeEach(() => {
  mockSimulate.mockReset();
});

describe('CubeDraftabilityPanel — collapsed', () => {
  it('is collapsed by default with one summary line, no body, and never calls the simulator', () => {
    render(<CubeDraftabilityPanel cube={cubeOf(60)} />);
    const toggle = screen.getByRole('button', { name: /Draftability/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('cube-draft-sim-body')).toBeNull();
    const summary = document.querySelector('.cube-draft-sim-summary');
    expect(summary).not.toBeNull();
    expect(summary!.textContent).toBe('Simulates 50 drafts when opened.');
    expect(mockSimulate).not.toHaveBeenCalled();
  });
});

describe('CubeDraftabilityPanel — running', () => {
  it('opening the section starts the simulation and shows a live-region running state', () => {
    mockSimulate.mockImplementation(() => pending(draftResult())); // stays pending for this test
    const cube = cubeOf(60);
    render(<CubeDraftabilityPanel cube={cube} />);
    openToggle();

    expect(mockSimulate).toHaveBeenCalledTimes(1);
    expect(mockSimulate).toHaveBeenCalledWith(
      cube.picks.map((p) => p.card),
      cube.size
    );
    const running = document.querySelector('.cube-draft-sim-running')!;
    expect(running).not.toBeNull();
    expect(running.getAttribute('role')).toBe('status');
    expect(running.getAttribute('aria-live')).toBe('polite');
    expect(running.getAttribute('aria-busy')).toBe('true');
    expect(running.textContent).toContain('Simulating 50 drafts');
    // The always-visible summary line stays up while loading (same as every
    // other state) — it must read as a shorter cue, not a stacked duplicate
    // of the body's own sentence right below it.
    const summary = document.querySelector('.cube-draft-sim-summary')!.textContent;
    expect(summary).toBe('Simulating…');
    expect(summary).not.toBe(running.textContent);
  });
});

describe('CubeDraftabilityPanel — loaded', () => {
  it('renders all three metrics: the reach stat, all 10 colour pairs, and undrafted archetypes', async () => {
    mockSimulate.mockResolvedValue(
      draftResult({ undraftedArchetypes: [{ axis: 'tokens', label: 'Tokens' }] })
    );
    render(<CubeDraftabilityPanel cube={cubeOf(360)} />);
    openToggle();

    await waitFor(() => expect(screen.getByText('96%')).toBeTruthy());
    expect(document.querySelector('.cube-draft-sim-summary')!.textContent).toBe(
      'Simulated 50 drafts: 96% of decks reached 23 playables in two colours.'
    );

    const rows = document.querySelectorAll('.cube-draft-sim-pair-row');
    expect(rows).toHaveLength(10);
    // Colour is never the only signal — every row carries a plain text label.
    const labelTexts = Array.from(document.querySelectorAll('.cube-draft-sim-pair-label')).map(
      (el) => el.textContent ?? ''
    );
    for (const pair of COLOR_PAIRS) {
      expect(labelTexts.some((t) => t.startsWith(pairOf(pair)))).toBe(true);
    }

    expect(screen.getByText('Tokens')).toBeTruthy();
    expect(document.querySelector('.cube-draft-sim-pill')!.textContent).toBe('Tokens');
  });

  it('says every archetype got drafted when none are missed', async () => {
    mockSimulate.mockResolvedValue(draftResult({ undraftedArchetypes: [] }));
    render(<CubeDraftabilityPanel cube={cubeOf(360)} />);
    openToggle();
    await waitFor(() =>
      expect(screen.getByText(/Every archetype this cube supports got drafted/)).toBeTruthy()
    );
    expect(document.querySelector('.cube-draft-sim-pill')).toBeNull();
  });
});

describe('CubeDraftabilityPanel — error and retry', () => {
  it('shows a plain error with a retry action; retrying re-runs the simulation', async () => {
    mockSimulate.mockRejectedValueOnce(new Error('boom'));
    render(<CubeDraftabilityPanel cube={cubeOf(360)} />);
    openToggle();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("Couldn't simulate the draft.");
    expect(mockSimulate).toHaveBeenCalledTimes(1);

    // The always-visible summary line must not repeat the error block's own
    // sentence stacked directly above it (same rule as the loading state).
    const summary = document.querySelector('.cube-draft-sim-summary')!.textContent;
    expect(summary).not.toBe(alert.textContent);
    expect(summary).not.toContain("Couldn't simulate the draft.");

    mockSimulate.mockResolvedValueOnce(draftResult());
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(screen.getByText('96%')).toBeTruthy());
    expect(mockSimulate).toHaveBeenCalledTimes(2);
  });
});

describe('CubeDraftabilityPanel — short cube', () => {
  it('states the pod THIS SIZE implies (not a hard-coded 8), and only when really short', async () => {
    // 180 implies a 4-player pod (sizeInfo), not the 8 the copy used to say
    // for every size.
    mockSimulate.mockResolvedValue(draftResult({ shortCube: true, playersPerRun: 2 }));
    render(<CubeDraftabilityPanel cube={cubeOf(50, 180)} />);
    openToggle();
    await waitFor(() =>
      expect(screen.getByText(/This cube has fewer cards than a 4-player pod needs/)).toBeTruthy()
    );
  });

  it('says nothing about a short pod when the cube is not short', async () => {
    mockSimulate.mockResolvedValue(draftResult({ shortCube: false }));
    render(<CubeDraftabilityPanel cube={cubeOf(360)} />);
    openToggle();
    await waitFor(() => expect(screen.getByText('96%')).toBeTruthy());
    expect(document.querySelector('.cube-draft-sim-sub')!.textContent).not.toMatch(/pod needs/);
  });
});

describe('CubeDraftabilityPanel — under-75% line', () => {
  it('adds one plain line when under 75% of decks reach the bar, with no warning icon', async () => {
    mockSimulate.mockResolvedValue(draftResult({ reachedBarShare: 0.5 }));
    render(<CubeDraftabilityPanel cube={cubeOf(360)} />);
    openToggle();
    await waitFor(() => expect(screen.getByText('50%')).toBeTruthy());

    const note = document.querySelector('.cube-draft-sim-note')!;
    expect(note).not.toBeNull();
    // The real number, not a vague "most decks" — true at 50% as much as 74%.
    // sizeInfo(360).players === 8.
    expect(note.textContent).toBe(
      'Only 50% of simulated decks reached a full two-colour build. The cube is likely thin in too many colour pairs for a 8-player pod.'
    );
    expect(note.querySelector('svg')).toBeNull();
    expect(note.className).not.toMatch(/warn|err|alert/i);
  });

  it('adds no line when the bar is comfortably cleared', async () => {
    mockSimulate.mockResolvedValue(draftResult({ reachedBarShare: 0.9 }));
    render(<CubeDraftabilityPanel cube={cubeOf(360)} />);
    openToggle();
    await waitFor(() => expect(screen.getByText('90%')).toBeTruthy());
    expect(document.querySelector('.cube-draft-sim-note')).toBeNull();
  });
});

describe('CubeDraftabilityPanel — cache', () => {
  it('does not re-run for the same cube after unmount/remount (reopening uses the cache)', async () => {
    mockSimulate.mockResolvedValue(draftResult());
    const cube = cubeOf(360);

    const first = render(<CubeDraftabilityPanel cube={cube} />);
    openToggle();
    await waitFor(() => expect(screen.getByText('96%')).toBeTruthy());
    first.unmount();

    render(<CubeDraftabilityPanel cube={cube} />);
    openToggle();
    // Cached — the report is there immediately, no loading state, no 2nd call.
    expect(screen.getByText('96%')).toBeTruthy();
    expect(document.querySelector('.cube-draft-sim-running')).toBeNull();
    expect(mockSimulate).toHaveBeenCalledTimes(1);
  });

  it('an edited cube (a new picks array) is a cache miss and re-runs', async () => {
    mockSimulate.mockResolvedValue(draftResult());
    const cubeA = cubeOf(360);

    const first = render(<CubeDraftabilityPanel cube={cubeA} />);
    openToggle();
    await waitFor(() => expect(screen.getByText('96%')).toBeTruthy());
    first.unmount();

    const cubeB = cubeOf(360); // same shape, distinct `picks` array reference
    render(<CubeDraftabilityPanel cube={cubeB} />);
    openToggle();
    expect(mockSimulate).toHaveBeenCalledTimes(2);
  });
});
