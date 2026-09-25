// @vitest-environment happy-dom
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DeckIdentityCard, type DeckIdentityCardProps } from './DeckIdentityCard';
import { Archetype } from '@/deck-builder/types';
import type {
  ValidationCheck,
  ValidationResult,
} from '@/deck-builder/services/deckBuilder/validationChecklist';
import type {
  PlanScore,
  SubScore,
  SubScoreKey,
} from '@/deck-builder/services/deckBuilder/planScore';
import { getCommanderStats, type CommanderStats } from '@/lib/aggregates-client';

// Stub the CDN thumb resolver. Rendering the card calls `useCardThumb(commanderName)`,
// which schedules a fire-and-forget `getCardsByNames` fetch (card-thumbs.ts) that, with
// no network in the test, logs `[Scryfall] Collection batch failed` *after* the test ends —
// racing vitest's worker teardown into `EnvironmentTeardownError: Closing rpc while
// "onUserConsoleLog" was pending`. Stubbing the hook removes the async fetch at the source.
vi.mock('@/lib/card-thumbs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/card-thumbs')>()),
  useCardThumb: () => undefined,
}));

// Commander-popularity stat's own fetch — stubbed per-test below.
vi.mock('@/lib/aggregates-client', () => ({ getCommanderStats: vi.fn() }));

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Build a ValidationResult from a check list, computing the roll-up counts. */
function makeValidation(checks: ValidationCheck[]): ValidationResult {
  return {
    checks,
    passCount: checks.filter((c) => c.status === 'pass').length,
    total: checks.length,
    hardFails: checks.filter((c) => c.status === 'fail').length,
    softWarns: checks.filter((c) => c.status === 'warn').length,
  };
}

const PASS = (id: string): ValidationCheck => ({ id, label: id, status: 'pass', detail: 'ok' });

function sub(value: number, bandLabel: string, partial = false): SubScore {
  return { value, surface: `${bandLabel} surface`, bandLabel, partial };
}

function makePlan(
  overall: number,
  subscores: Record<SubScoreKey, SubScore>,
  overrides: Partial<PlanScore> = {}
): PlanScore {
  return {
    overall,
    bandLabel: 'Healthy',
    headline: 'Your deck is performing well, with a little room to grow.',
    byline: 'Based on aggregated EDHREC data.',
    subscores,
    limitedData: false,
    ...overrides,
  };
}

const healthyPlan = makePlan(82, {
  strategy: sub(85, 'Healthy'),
  roles: sub(80, 'Healthy'),
  curve: sub(48, 'Rough'),
  cardFit: sub(78, 'Healthy'),
});

const base: DeckIdentityCardProps = {
  commander: null,
  format: 'commander',
  analysisState: 'ready',
  validation: makeValidation([PASS('size'), PASS('identity')]),
  planScore: healthyPlan,
  identity: null,
};

function renderCard(overrides: Partial<DeckIdentityCardProps> = {}) {
  return render(<DeckIdentityCard {...base} {...overrides} />);
}

/** Match by an element's full (whitespace-collapsed) textContent across common text elements. */
function hasText(re: RegExp): boolean {
  return Array.from(document.querySelectorAll('p, span, strong, li, h4')).some((el) =>
    re.test((el.textContent ?? '').replace(/\s+/g, ' ').trim())
  );
}

/** A row's parts (its child elements) read as one line, space-separated. */
function rowText(el: Element): string {
  return Array.from(el.children)
    .map((c) => (c.textContent ?? '').trim())
    .filter(Boolean)
    .join(' ');
}

/** Each listed check as "glyph label detail". */
function checkRows(): string[] {
  return Array.from(document.querySelectorAll('.deck-identity-card-check')).map(rowText);
}

describe('DeckIdentityCard', () => {
  // ── Deck checks: every check, with its number ─────────────────────────────

  it('lists every check with its detail, passes included', () => {
    renderCard();
    expect(checkRows()).toEqual(['✓ size ok', '✓ identity ok']);
    expect(hasText(/^2 of 2 pass$/)).toBe(true);
  });

  it('never repeats the verdict words the strip owns ("All clear", "N to fix")', () => {
    const checks: ValidationCheck[] = [
      { id: 'size', label: 'Deck size', status: 'fail', detail: '98 / 100 cards' },
      PASS('curve'),
    ];
    renderCard({ validation: makeValidation(checks) });
    expect(hasText(/All clear|to fix|to tune/)).toBe(false);
  });

  it('marks warn and fail rows with their own glyph, not color alone', () => {
    const checks: ValidationCheck[] = [
      { id: 'size', label: 'Deck size', status: 'fail', detail: '98 / 100 cards' },
      { id: 'removal', label: 'Removal count', status: 'warn', detail: '6 / 8' },
      PASS('curve'),
    ];
    const { container } = renderCard({ validation: makeValidation(checks) });
    expect(checkRows()).toEqual([
      '✗ Deck size 98 / 100 cards',
      '▾ Removal count 6 / 8',
      '✓ curve ok',
    ]);
    expect(container.querySelector('.deck-identity-card-check.is-fail')).not.toBeNull();
    expect(container.querySelector('.deck-identity-card-check.is-warn')).not.toBeNull();
  });

  // ── UX-311: a check that needs work links to the Coach lane that fixes it ─

  it('offers "Fix in Coach" on a tunable check and navigates to fill-gaps', () => {
    const onNavigate = vi.fn();
    const checks: ValidationCheck[] = [
      PASS('size'),
      { id: 'removal', label: 'Removal count', status: 'warn', detail: '6 / 8' },
    ];
    renderCard({ validation: makeValidation(checks), onNavigate });
    fireEvent.click(screen.getByRole('button', { name: 'Removal count 6 / 8, fix in Coach' }));
    expect(onNavigate).toHaveBeenCalledWith('fill-gaps');
  });

  it('offers no fix link on a hard rule or a passing check', () => {
    const checks: ValidationCheck[] = [
      { id: 'size', label: 'Deck size', status: 'fail', detail: '98 / 100 cards' },
      { id: 'identity', label: 'Commander identity', status: 'fail', detail: '2 off-color' },
      { id: 'singleton', label: 'Singleton', status: 'fail', detail: '1 duplicate' },
      { id: 'ramp', label: 'Ramp count', status: 'pass', detail: '12 / 10' },
    ];
    renderCard({ validation: makeValidation(checks), onNavigate: vi.fn() });
    // Hard rules need card edits in the list; a pass needs nothing.
    expect(screen.queryAllByRole('button', { name: /fix in Coach/i })).toHaveLength(0);
  });

  it('offers no fix link without onNavigate', () => {
    renderCard({
      validation: makeValidation([
        { id: 'ramp', label: 'Ramp count', status: 'warn', detail: '4 / 10' },
      ]),
    });
    expect(screen.queryAllByRole('button', { name: /fix in Coach/i })).toHaveLength(0);
  });

  // ── Build health: four meters, the 70 line, a headline that agrees ───────

  it('shows each sub-score with the 70 line marked, and names the soft spot', () => {
    const { container } = renderCard();
    const rows = Array.from(container.querySelectorAll('.deck-identity-card-health-row'));
    expect(rows.map(rowText)).toEqual(['Strategy 85', 'Roles 80', 'Curve 48', 'Card fit 78']);
    expect(container.querySelectorAll('.meterbar-tick')).toHaveLength(4);
    // Curve (48) is under the line, so it is the soft spot.
    expect(rows[2].classList.contains('is-soft')).toBe(true);
    expect(hasText(/The soft spot is curve\.$/)).toBe(true);
  });

  it('builds the band and headline from the score, not the stored copy', () => {
    // A 64 was stored as "Needs work" over "Your deck is solid"; the page now
    // derives both from the number so they agree, old analyses included.
    const plan = makePlan(
      64,
      {
        strategy: sub(58, 'x'),
        roles: sub(70, 'x'),
        curve: sub(72, 'x'),
        cardFit: sub(60, 'x'),
      },
      { bandLabel: 'Needs work', headline: 'Your deck is solid, with clear room for improvement.' }
    );
    renderCard({ planScore: plan });
    expect(hasText(/^Needs work$/)).toBe(true);
    expect(hasText(/Your deck has the foundation\. It needs some tuning\./)).toBe(true);
    expect(hasText(/is solid/)).toBe(false);
  });

  it('names no soft spot when every scored part clears the line', () => {
    const plan = makePlan(84, {
      strategy: sub(80, 'x'),
      roles: sub(90, 'x'),
      curve: sub(75, 'x'),
      cardFit: sub(88, 'x'),
    });
    renderCard({ planScore: plan });
    expect(hasText(/soft spot/)).toBe(false);
  });

  it('tags "limited data" and skips partial sub-scores for the soft spot', () => {
    const plan = makePlan(
      70,
      {
        strategy: sub(50, 'Unscored', true), // partial — excluded
        roles: sub(72, 'x'),
        curve: sub(64, 'x'),
        cardFit: sub(80, 'x'),
      },
      { limitedData: true }
    );
    renderCard({ planScore: plan });
    expect(hasText(/Dialed in · limited data/)).toBe(true);
    const strategy = document.querySelector('.deck-identity-card-health-row');
    expect(rowText(strategy as Element)).toBe('Strategy not scored');
    expect(hasText(/The soft spot is curve\./)).toBe(true);
  });

  it('shows no scores when planScore is null and analysis is ready', () => {
    renderCard({ planScore: null });
    expect(document.querySelector('.deck-identity-card-health')).toBeNull();
  });

  it('shows the Build health skeleton while analysis is pending (no planScore yet)', () => {
    const { container } = renderCard({ analysisState: 'pending', planScore: null });
    expect(container.querySelector('.deck-identity-card-skeleton')).not.toBeNull();
    expect(hasText(/^Analyzing this deck…$/)).toBe(true);
  });

  // ── E162: error/stalled analysis state ────────────────────────────────────

  it('shows a Build health failure message with retry when analysis errors (no planScore)', () => {
    const onRetryAnalysis = vi.fn();
    const { container } = renderCard({
      analysisState: 'error',
      planScore: null,
      onRetryAnalysis,
    });
    expect(container.querySelector('.deck-identity-card-skeleton')).toBeNull();
    expect(hasText(/Couldn.t analyze this deck\./)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetryAnalysis).toHaveBeenCalledTimes(1);
  });

  it('omits the retry button when onRetryAnalysis is not provided', () => {
    renderCard({ analysisState: 'error', planScore: null });
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  // ── Defect 2: a partial (EDHREC-missing) analysis ─────────────────────────

  it('shows a retryable EDHREC-missing notice in Build health when ready but planScore never landed', () => {
    const onRetryAnalysis = vi.fn();
    renderCard({ analysisState: 'ready', edhrecMissing: true, planScore: null, onRetryAnalysis });
    expect(hasText(/Couldn.t reach EDHREC/)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetryAnalysis).toHaveBeenCalledTimes(1);
  });

  it('shows the real planScore instead of the EDHREC-missing notice once one lands', () => {
    renderCard({ analysisState: 'ready', edhrecMissing: true, planScore: healthyPlan });
    expect(hasText(/Couldn.t reach EDHREC/)).toBe(false);
    expect(hasText(/^Dialed in$/)).toBe(true);
  });

  // ── One fact, one place ──────────────────────────────────────────────────

  it('repeats none of the page hero: no commander names, art, bracket or brand mark', () => {
    // The card leads the stats under the deck list, and the hero right above
    // the list already carries the commander art, the names, the format and
    // the bracket.
    const commander = {
      name: "Atraxa, Praetors' Voice",
      color_identity: ['W', 'U', 'B', 'G'],
      image_uris: { art_crop: 'https://example.test/atraxa.jpg' },
    } as unknown as DeckIdentityCardProps['commander'];
    const partnerCommander = {
      name: 'Tymna the Weaver',
      color_identity: ['W', 'B'],
    } as unknown as DeckIdentityCardProps['partnerCommander'];
    const { container } = renderCard({ commander, partnerCommander });
    expect(hasText(/Atraxa|Tymna|Bracket|SpellControl/)).toBe(false);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('h2')).toBeNull();
  });

  // ── Plays as ─────────────────────────────────────────────────────────────

  const identity = { archetypeLabel: 'Voltron', pacingShort: 'Late game', themes: [] };

  it('leads with what the deck plays as, and mounts the radar without an expander', async () => {
    // Load the lazy radar's module before rendering. Waiting for it with the
    // default 1s findBy timed out under the full suite with coverage, where
    // transforming the chunk alone can take longer.
    await import('./PlaystyleRadar');
    const { container } = renderCard({ identity });
    expect(screen.getByRole('heading', { level: 4, name: 'Voltron' })).toBeTruthy();
    expect(hasText(/^Late game$/)).toBe(true);
    expect(container.querySelector('.deck-identity-card-radar')).not.toBeNull();
    // Wait for the lazy radar itself. Its "What is playstyle radar?" tip is a
    // button, so this asserts in the state that used to fail on CI: the old
    // unanchored /playstyle/ passed or failed on whether the radar's chunk had
    // resolved yet (module-cache order across files), and red main skips the
    // deploy. No "Playstyle" expander means no button NAMED Playstyle.
    await screen.findByRole('button', { name: 'What is playstyle radar?' });
    expect(screen.queryByRole('button', { name: /^playstyle/i })).toBeNull();
  });

  it('says how the deck is built, with the numbers the radar shows', () => {
    const equipment = Array.from({ length: 6 }, (_, i) => ({
      name: `Blade ${i}`,
      type_line: 'Artifact — Equipment',
      oracle_text: 'Equip {2}',
      cmc: 2,
    }));
    const sram = {
      name: 'Sram',
      type_line: 'Legendary Creature — Dwarf Advisor',
      oracle_text: 'Whenever you cast an Aura, Equipment, or Vehicle spell, draw a card.',
      cmc: 2,
    };
    const land = { name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '', cmc: 0 };
    renderCard({
      identity,
      cards: [sram, ...equipment, land] as unknown as DeckIdentityCardProps['cards'],
    });
    expect(hasText(/^7 of 7 spells build the Equipment \/ Voltron engine\.$/)).toBe(true);
  });

  it('shows the archetype as plain text when onSetArchetypeOverride is absent', () => {
    renderCard({ identity });
    expect(screen.queryByRole('button', { name: /change deck archetype/i })).toBeNull();
  });

  it('the picker trigger says whose call it is, and sets an override on pick', () => {
    const onSet = vi.fn();
    renderCard({ identity, archetypeOverride: null, onSetArchetypeOverride: onSet });

    const trigger = screen.getByRole('button', { name: /change deck archetype/i });
    expect(trigger.textContent).toContain('Auto');

    act(() => {
      fireEvent.click(trigger);
    });
    act(() => {
      fireEvent.click(screen.getByRole('option', { name: 'Tribal' }));
    });
    expect(onSet).toHaveBeenCalledWith(Archetype.TRIBAL);
  });

  it('clears the override back to auto when "Auto" is picked', () => {
    const onSet = vi.fn();
    renderCard({
      identity: { ...identity, archetypeLabel: 'Tribal' },
      archetypeOverride: Archetype.TRIBAL,
      onSetArchetypeOverride: onSet,
    });

    const trigger = screen.getByRole('button', { name: /change deck archetype/i });
    expect(trigger.textContent).toContain('Your pick');
    act(() => {
      fireEvent.click(trigger);
    });
    expect(screen.getByRole('option', { name: 'Tribal' }).getAttribute('aria-selected')).toBe(
      'true'
    );
    act(() => {
      fireEvent.click(screen.getByRole('option', { name: 'Auto' }));
    });
    expect(onSet).toHaveBeenCalledWith(null);
  });

  it('does not render a picker for non-commander decks (no identity)', () => {
    renderCard({ identity: null, onSetArchetypeOverride: vi.fn() });
    expect(screen.queryByRole('button', { name: /change deck archetype/i })).toBeNull();
    expect(screen.getByRole('heading', { level: 4, name: 'Commander deck' })).toBeTruthy();
  });
});

// ── Commander popularity stat (social W4) ────────────────────────────────────

const commanderWithId = {
  name: "Atraxa, Praetors' Voice",
  oracle_id: 'oracle-atraxa',
  color_identity: ['W', 'U', 'B', 'G'],
} as unknown as DeckIdentityCardProps['commander'];

const fixtureStats: CommanderStats = {
  commanderKey: 'oracle-atraxa',
  commanderName: "Atraxa, Praetors' Voice",
  partnerName: null,
  deckCount: 156,
  avgBracket: null,
  bracketSampleCount: 0,
  budgetDistribution: { low: null, mid: null, high: null },
  topCards: [],
};

describe('DeckIdentityCard — commander popularity stat', () => {
  beforeEach(() => {
    vi.mocked(getCommanderStats).mockReset();
  });

  it('fetches commander stats once per commanderKey change, not per re-render', async () => {
    const mock = vi.mocked(getCommanderStats).mockResolvedValue(fixtureStats);
    const { rerender } = renderCard({ commander: commanderWithId });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock).toHaveBeenCalledWith('oracle-atraxa');

    // Re-render with the same commander (same oracle_id) — must not refetch.
    rerender(<DeckIdentityCard {...base} commander={commanderWithId} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('does not fetch when commander is null', async () => {
    const mock = vi.mocked(getCommanderStats);
    renderCard({ commander: null });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mock).not.toHaveBeenCalled();
  });

  it('does not fetch for a paupercommander deck (no EDHREC data there either)', async () => {
    const mock = vi.mocked(getCommanderStats);
    renderCard({ commander: commanderWithId, format: 'paupercommander' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(mock).not.toHaveBeenCalled();
  });

  it('does not set state after unmount while a stats fetch is in flight', async () => {
    let resolveStats: (v: CommanderStats | null) => void = () => {};
    const pending = new Promise<CommanderStats | null>((resolve) => {
      resolveStats = resolve;
    });
    vi.mocked(getCommanderStats).mockReturnValue(pending);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = renderCard({ commander: commanderWithId });
    unmount();
    await act(async () => {
      resolveStats(fixtureStats);
      await pending;
    });

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('renders the blended stat once both the threaded edhrecNumDecks prop and the platform count are ready', async () => {
    vi.mocked(getCommanderStats).mockResolvedValue(fixtureStats);
    renderCard({
      commander: commanderWithId,
      edhrecNumDecks: 12400,
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(hasText(/156 on SpellControl · 12,400 on EDHREC/)).toBe(true);
  });
});
