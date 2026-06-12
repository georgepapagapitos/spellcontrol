// @vitest-environment happy-dom
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DeckIdentityCard, type DeckIdentityCardProps } from './DeckIdentityCard';
import type {
  ValidationCheck,
  ValidationResult,
} from '@/deck-builder/services/deckBuilder/validationChecklist';
import type {
  PlanScore,
  SubScore,
  SubScoreKey,
} from '@/deck-builder/services/deckBuilder/planScore';

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
  deckName: 'Test deck',
  format: 'commander',
  deckColor: '#3a7bd5',
  bracket: undefined,
  analysisPending: false,
  validation: makeValidation([PASS('size'), PASS('identity')]),
  planScore: healthyPlan,
  manaCurve: {},
  identity: null,
  averageCmc: 3.0,
};

function renderCard(overrides: Partial<DeckIdentityCardProps> = {}) {
  return render(<DeckIdentityCard {...base} {...overrides} />);
}

/** Match by an element's full (whitespace-collapsed) textContent across common text elements. */
function hasText(re: RegExp): boolean {
  return Array.from(document.querySelectorAll('p, span, strong, li')).some((el) =>
    re.test((el.textContent ?? '').replace(/\s+/g, ' ').trim())
  );
}

/** Collect all shortfall item texts (each <li> in the shortfall list). */
function shortfallTexts(): string[] {
  return Array.from(document.querySelectorAll('.deck-identity-card-shortfall-item')).map((el) =>
    (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  );
}

describe('DeckIdentityCard', () => {
  it('renders an all-clear verdict + healthy plan with its weakest soft spot', () => {
    renderCard();
    expect(hasText(/^✓ ?All clear$/)).toBe(true);
    expect(hasText(/^2 of 2 checks pass$/)).toBe(true);
    expect(hasText(/^82 · Healthy$/)).toBe(true);
    expect(
      screen.getByText('Your deck is performing well, with a little room to grow.')
    ).toBeTruthy();
    // curve (48) is the weakest non-partial subscore.
    expect(hasText(/^soft spot: Curve — Rough$/)).toBe(true);
  });

  it('shows "N to fix" with named shortfalls (first 3) and "+k more" when over three', () => {
    const checks: ValidationCheck[] = [
      { id: 'size', label: 'Deck size', status: 'fail', detail: '98 / 100 cards' },
      { id: 'identity', label: 'Commander identity', status: 'fail', detail: '2 off-color cards' },
      { id: 'singleton', label: 'Singleton', status: 'fail', detail: '1 duplicate name' },
      { id: 'ramp', label: 'Ramp count', status: 'fail', detail: '4 / 10' },
      { id: 'removal', label: 'Removal count', status: 'fail', detail: '6 / 8' },
      PASS('curve'),
    ];
    renderCard({ validation: makeValidation(checks) });
    expect(hasText(/^✗ ?5 to fix$/)).toBe(true);
    // First three items in the list, then "+2 more".
    const items = shortfallTexts();
    expect(items[0]).toMatch(/Deck size 98 \/ 100 cards/);
    expect(items[1]).toMatch(/Commander identity 2 off-color cards/);
    expect(items[2]).toMatch(/Singleton 1 duplicate name/);
    expect(items[3]).toMatch(/\+2 more/);
  });

  it('shows "N to tune" when there are only soft warnings', () => {
    const checks: ValidationCheck[] = [
      PASS('size'),
      { id: 'removal', label: 'Removal count', status: 'warn', detail: '6 / 8' },
      { id: 'curve', label: 'Curve', status: 'warn', detail: 'Avg MV 3.80' },
    ];
    renderCard({ validation: makeValidation(checks) });
    expect(hasText(/^▾ ?2 to tune$/)).toBe(true);
    const items = shortfallTexts();
    expect(items[0]).toMatch(/Removal count 6 \/ 8/);
    expect(items[1]).toMatch(/Curve Avg MV 3.80/);
  });

  it('renders only the Functional pillar when planScore is null', () => {
    renderCard({ planScore: null });
    expect(hasText(/^✓ ?All clear$/)).toBe(true);
    expect(screen.queryByText('Build health')).toBeNull();
    expect(hasText(/soft spot:/)).toBe(false);
  });

  it('tags "limited data" and picks the weakest from non-partial subscores only', () => {
    const plan = makePlan(
      70,
      {
        strategy: sub(50, 'Thin', true), // partial — excluded
        roles: sub(72, 'Solid'),
        curve: sub(64, 'Solid'),
        cardFit: sub(80, 'Healthy'),
      },
      { bandLabel: 'Solid', limitedData: true }
    );
    renderCard({ planScore: plan });
    expect(hasText(/^70 · Solid · limited data$/)).toBe(true);
    // curve (64) is the weakest of the non-partial entries; the partial strategy (50) is ignored.
    expect(hasText(/^soft spot: Curve — Solid$/)).toBe(true);
    expect(hasText(/soft spot: Strategy/)).toBe(false);
  });

  it('omits the soft-spot line when every subscore is partial', () => {
    const plan = makePlan(0, {
      strategy: sub(50, 'Unscored', true),
      roles: sub(50, 'Unscored', true),
      curve: sub(50, 'Unscored', true),
      cardFit: sub(50, 'Unscored', true),
    });
    renderCard({ planScore: plan });
    expect(hasText(/soft spot:/)).toBe(false);
  });

  // ── UX-311: shortfall deep-link buttons ───────────────────────────────────

  it('renders tunable shortfalls as plain text when onNavigate is not provided', () => {
    const checks: ValidationCheck[] = [
      PASS('size'),
      { id: 'ramp', label: 'Ramp count', status: 'warn', detail: '4 / 10' },
    ];
    renderCard({ validation: makeValidation(checks) });
    expect(screen.queryByRole('button', { name: /Ramp count/i })).toBeNull();
    expect(shortfallTexts()[0]).toMatch(/Ramp count 4 \/ 10/);
  });

  it('renders tunable shortfalls as buttons when onNavigate is provided', () => {
    const checks: ValidationCheck[] = [
      PASS('size'),
      { id: 'ramp', label: 'Ramp count', status: 'warn', detail: '4 / 10' },
    ];
    renderCard({ validation: makeValidation(checks), onNavigate: vi.fn() });
    const btn = screen.getByRole('button', { name: /Ramp count 4 \/ 10 — go to Tune/i });
    expect(btn).toBeTruthy();
  });

  it('calls onNavigate with "fill-gaps" when a tunable shortfall button is clicked', () => {
    const onNavigate = vi.fn();
    const checks: ValidationCheck[] = [
      PASS('size'),
      { id: 'removal', label: 'Removal count', status: 'warn', detail: '6 / 8' },
    ];
    renderCard({ validation: makeValidation(checks), onNavigate });
    const btn = screen.getByRole('button', { name: /Removal count/i });
    fireEvent.click(btn);
    expect(onNavigate).toHaveBeenCalledWith('fill-gaps');
  });

  it('hard-rule checks (size, identity, singleton) render as plain text even with onNavigate', () => {
    const checks: ValidationCheck[] = [
      { id: 'size', label: 'Deck size', status: 'fail', detail: '98 / 100 cards' },
      { id: 'identity', label: 'Commander identity', status: 'fail', detail: '2 off-color' },
      { id: 'singleton', label: 'Singleton', status: 'fail', detail: '1 duplicate' },
    ];
    renderCard({ validation: makeValidation(checks), onNavigate: vi.fn() });
    // No Tune deep-link for hard-rule failures — they require card edits in the Deck view.
    expect(screen.queryAllByRole('button', { name: /go to Tune/i })).toHaveLength(0);
  });

  it('shows the Build health skeleton while analysis is pending (no planScore yet)', () => {
    // A pending first analysis means planScore is absent — the skeleton must not
    // depend on planScore existing.
    const { container } = renderCard({ analysisPending: true, planScore: null });
    expect(container.querySelector('.deck-identity-card-skeleton-pillar')).not.toBeNull();
    expect(hasText(/^Build health$/)).toBe(true);
    expect(container.querySelector('.deck-identity-card-pillars.is-solo')).toBeNull();
  });

  it('renders commander + partner names and the human format label', () => {
    const commander = {
      name: "Atraxa, Praetors' Voice",
      color_identity: ['W', 'U', 'B', 'G'],
    } as unknown as DeckIdentityCardProps['commander'];
    const partnerCommander = {
      name: 'Tymna the Weaver',
      color_identity: ['W', 'B'],
    } as unknown as DeckIdentityCardProps['partnerCommander'];
    renderCard({ commander, partnerCommander });
    expect(hasText(/Atraxa, Praetors' Voice · Tymna the Weaver/)).toBe(true);
    // DECK_FORMAT_CONFIGS label, not the raw 'commander' id.
    expect(hasText(/^Commander$/)).toBe(true);
  });

  // ── Playstyle expander ────────────────────────────────────────────────────

  it('Playstyle expander is collapsed by default', () => {
    const { container } = renderCard();
    const body = container.querySelector('#deck-identity-playstyle-body');
    expect(body).not.toBeNull();
    // The body is hidden when collapsed
    expect(body!.hasAttribute('hidden')).toBe(true);
  });

  it('Playstyle toggle button has aria-expanded=false when collapsed', () => {
    renderCard();
    const toggle = screen.getByRole('button', { name: /playstyle/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('radar body mounts on expand (lazy-mount: not present before first expand)', () => {
    const { container } = renderCard({ cards: [] });
    // Before expand: no PlaystyleRadar content inside the body
    const body = container.querySelector('#deck-identity-playstyle-body');
    expect(body).not.toBeNull();
    // The body is hidden initially
    expect(body!.hasAttribute('hidden')).toBe(true);
  });

  it('toggle opens and closes the expander', () => {
    const { container } = renderCard({ cards: [] });
    const toggle = screen.getByRole('button', { name: /playstyle/i });

    // Open
    act(() => {
      fireEvent.click(toggle);
    });
    const body = container.querySelector('#deck-identity-playstyle-body');
    expect(body!.hasAttribute('hidden')).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    // Close again
    act(() => {
      fireEvent.click(toggle);
    });
    expect(body!.hasAttribute('hidden')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
});
