// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CommanderCoveragePanel } from './CubeCommanders';
import { simulateCommanderDraftAsync } from '../../lib/cube/generate-async';
import type { CommanderDraftSimResult } from '../../lib/cube/draft-sim';
import type { GeneratedCube, Pick } from '../../lib/cube/generate';
import type { LegendPick } from '../../lib/cube/legend';
import { BUCKET_ORDER } from './shared';
import { pending } from '../../test/pending';

vi.mock('../../lib/cube/generate-async', () => ({
  simulateCommanderDraftAsync: vi.fn(),
}));

const mockSimulate = vi.mocked(simulateCommanderDraftAsync);

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

function legendPick(overrides: Partial<LegendPick['card']> = {}): LegendPick {
  id += 1;
  return {
    card: {
      name: `Legend ${id}`,
      oracleId: `legend-oracle-${id}`,
      colors: ['W'],
      cmc: 3,
      typeLine: 'Legendary Creature — Human',
      role: null,
      ...overrides,
    },
    identity: 'W',
    reason: 'W legend (1 of 1)',
  };
}

function cubeOf(pickCount: number, legends: LegendPick[] | undefined): GeneratedCube {
  const picks = Array.from({ length: pickCount }, () => pick());
  return {
    size: 360,
    format: 'commander',
    picks,
    byBucket: { ...ZERO_BUCKETS, U: pickCount },
    targetByBucket: ZERO_BUCKETS,
    gaps: [],
    shortfall: 0,
    poolSize: pickCount,
    legends,
  };
}

function simResult(overrides: Partial<CommanderDraftSimResult> = {}): CommanderDraftSimResult {
  return {
    runs: 50,
    playersPerRun: 8,
    packsPerPlayer: 3,
    cardsPerPack: 15,
    totalDecks: 400,
    shortCube: false,
    builtDeckShare: 0.6,
    noCommanderShare: 0.1,
    identityShares: [
      { identity: 'W', share: 0.3 },
      { identity: 'WU', share: 0.2 },
    ],
    unbuildableIdentities: [],
    ...overrides,
  };
}

function openToggle() {
  fireEvent.click(screen.getByRole('button', { name: /Commander coverage/ }));
}

beforeEach(() => {
  mockSimulate.mockReset();
  id = 0;
});

describe('CommanderCoveragePanel — not commander / pre-legends / empty', () => {
  it('renders nothing for a non-commander cube', () => {
    const cube = cubeOf(60, undefined);
    cube.format = 'limited';
    const { container } = render(<CommanderCoveragePanel cube={cube} />);
    expect(container.firstChild).toBeNull();
  });

  it('a cube saved before the legend section shipped says so, and never calls the simulator', () => {
    render(<CommanderCoveragePanel cube={cubeOf(60, undefined)} />);
    expect(screen.getByText('No legend section yet. Rebuild this cube to add one.')).toBeTruthy();
    openToggle();
    expect(document.getElementById('cube-commander-coverage-body')).toBeNull();
    expect(mockSimulate).not.toHaveBeenCalled();
  });

  it('a ready cube with zero legends says so and never calls the simulator', () => {
    render(<CommanderCoveragePanel cube={cubeOf(60, [])} />);
    expect(screen.getByText('No commanders in this cube.')).toBeTruthy();
    openToggle();
    expect(mockSimulate).not.toHaveBeenCalled();
  });
});

describe('CommanderCoveragePanel — collapsed with commanders', () => {
  it('is collapsed by default, states the coverage fact, and never calls the simulator', () => {
    const legends = [legendPick({ colors: ['W'] }), legendPick({ colors: ['W', 'U'] })];
    legends[1].identity = 'WU';
    render(<CommanderCoveragePanel cube={cubeOf(60, legends)} />);
    const toggle = screen.getByRole('button', { name: /Commander coverage/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('cube-commander-coverage-body')).toBeNull();
    expect(screen.getByText('2 commanders across 2 color identities.')).toBeTruthy();
    expect(mockSimulate).not.toHaveBeenCalled();
  });
});

describe('CommanderCoveragePanel — running', () => {
  it('opening the section starts the simulation and shows a live-region running state', () => {
    mockSimulate.mockImplementation(() => pending(simResult()));
    const legends = [legendPick()];
    const cube = cubeOf(60, legends);
    render(<CommanderCoveragePanel cube={cube} />);
    openToggle();

    expect(mockSimulate).toHaveBeenCalledTimes(1);
    expect(mockSimulate).toHaveBeenCalledWith(
      cube.picks.map((p) => p.card),
      legends.map((l) => l.card),
      cube.size
    );
    const running = document.querySelector('.cube-commander-coverage-running')!;
    expect(running).not.toBeNull();
    expect(running.getAttribute('role')).toBe('status');
    expect(running.getAttribute('aria-live')).toBe('polite');
    expect(running.getAttribute('aria-busy')).toBe('true');

    // The static grid stays visible while the simulation runs — the panel
    // "keeps its static grid and gains the simulation," not replaces it.
    expect(document.querySelector('.cube-coverage-grid')).not.toBeNull();
    const summary = document.querySelector('.cube-commander-coverage-summary')!.textContent;
    expect(summary).toBe('Simulating…');
  });
});

describe('CommanderCoveragePanel — loaded', () => {
  it('upgrades the summary and renders the buildable share, identities drafted, and unbuildable identities', async () => {
    mockSimulate.mockResolvedValue(
      simResult({ builtDeckShare: 0.55, unbuildableIdentities: ['BG'] })
    );
    const legends = [legendPick()];
    render(<CommanderCoveragePanel cube={cubeOf(360, legends)} />);
    openToggle();

    await waitFor(() => expect(screen.getByText('55%')).toBeTruthy());
    expect(document.querySelector('.cube-commander-coverage-summary')!.textContent).toBe(
      'Simulated 50 drafts: 55% of drafters built a legal commander deck.'
    );

    // Both identities with a nonzero share render as rows.
    expect(document.querySelectorAll('.cube-commander-coverage-identity-row')).toHaveLength(2);
    // The unbuildable identity renders as a plain pill.
    expect(document.querySelector('.cube-commander-coverage-pill')!.textContent).toBe('BG');
  });

  it('says every supported identity got built when nothing is unbuildable', async () => {
    mockSimulate.mockResolvedValue(simResult({ unbuildableIdentities: [] }));
    render(<CommanderCoveragePanel cube={cubeOf(360, [legendPick()])} />);
    openToggle();
    await waitFor(() =>
      expect(screen.getByText(/Every color identity this cube supports got built/)).toBeTruthy()
    );
    expect(document.querySelector('.cube-commander-coverage-pill')).toBeNull();
  });

  it('states the pod size implied by THIS cube size when short', async () => {
    mockSimulate.mockResolvedValue(simResult({ shortCube: true, playersPerRun: 2 }));
    const cube = cubeOf(30, [legendPick()]);
    cube.size = 180; // sizeInfo(180).players === 4
    render(<CommanderCoveragePanel cube={cube} />);
    openToggle();
    await waitFor(() =>
      expect(screen.getByText(/This cube has fewer cards than a 4-player pod needs/)).toBeTruthy()
    );
  });
});

describe('CommanderCoveragePanel — error and retry', () => {
  it('shows a plain error with a retry action; retrying re-runs the simulation', async () => {
    mockSimulate.mockRejectedValueOnce(new Error('boom'));
    render(<CommanderCoveragePanel cube={cubeOf(360, [legendPick()])} />);
    openToggle();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain("Couldn't simulate the draft.");
    expect(mockSimulate).toHaveBeenCalledTimes(1);
    // The error state doesn't regress the summary below its idle fact.
    const summary = document.querySelector('.cube-commander-coverage-summary')!.textContent;
    expect(summary).not.toContain("Couldn't simulate the draft.");

    mockSimulate.mockResolvedValueOnce(simResult());
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(screen.getByText('60%')).toBeTruthy());
    expect(mockSimulate).toHaveBeenCalledTimes(2);
  });
});

describe('CommanderCoveragePanel — cache', () => {
  it('does not re-run for the same cube after unmount/remount (reopening uses the cache)', async () => {
    mockSimulate.mockResolvedValue(simResult());
    const cube = cubeOf(360, [legendPick()]);

    const first = render(<CommanderCoveragePanel cube={cube} />);
    openToggle();
    await waitFor(() => expect(screen.getByText('60%')).toBeTruthy());
    first.unmount();

    render(<CommanderCoveragePanel cube={cube} />);
    openToggle();
    expect(screen.getByText('60%')).toBeTruthy();
    expect(document.querySelector('.cube-commander-coverage-running')).toBeNull();
    expect(mockSimulate).toHaveBeenCalledTimes(1);
  });

  it('an edited cube (a new picks array) is a cache miss and re-runs', async () => {
    mockSimulate.mockResolvedValue(simResult());
    const legends = [legendPick()];
    const cubeA = cubeOf(360, legends);

    const first = render(<CommanderCoveragePanel cube={cubeA} />);
    openToggle();
    await waitFor(() => expect(screen.getByText('60%')).toBeTruthy());
    first.unmount();

    const cubeB = cubeOf(360, legends); // same shape, distinct `picks` array reference
    render(<CommanderCoveragePanel cube={cubeB} />);
    openToggle();
    expect(mockSimulate).toHaveBeenCalledTimes(2);
  });
});
