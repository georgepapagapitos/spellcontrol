// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatsHero, type StatsHeroProps } from './StatsHero';
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

const base: StatsHeroProps = {
  validation: makeValidation([PASS('size'), PASS('identity')]),
  planScore: healthyPlan,
};

function renderHero(overrides: Partial<StatsHeroProps> = {}) {
  return render(<StatsHero {...base} {...overrides} />);
}

/** Match by an element's full (whitespace-collapsed) textContent. */
function hasText(re: RegExp): boolean {
  return Array.from(document.querySelectorAll('p, span, strong')).some((el) =>
    re.test((el.textContent ?? '').replace(/\s+/g, ' ').trim())
  );
}

describe('StatsHero', () => {
  it('renders an all-clear verdict + healthy plan with its weakest soft spot', () => {
    renderHero();
    expect(hasText(/^✓ ?All clear$/)).toBe(true);
    expect(hasText(/^2 of 2 checks pass$/)).toBe(true);
    expect(hasText(/^82 · Healthy$/)).toBe(true);
    expect(
      screen.getByText('Your deck is performing well, with a little room to grow.')
    ).toBeTruthy();
    // curve (48) is the weakest non-partial subscore.
    expect(hasText(/^soft spot: Curve — Rough$/)).toBe(true);
  });

  it('shows "N to fix" with named shortfalls and "+k more" when over three', () => {
    const checks: ValidationCheck[] = [
      { id: 'size', label: 'Deck size', status: 'fail', detail: '98 / 100 cards' },
      { id: 'identity', label: 'Commander identity', status: 'fail', detail: '2 off-color cards' },
      { id: 'singleton', label: 'Singleton', status: 'fail', detail: '1 duplicate name' },
      { id: 'ramp', label: 'Ramp count', status: 'fail', detail: '4 / 10' },
      { id: 'removal', label: 'Removal count', status: 'fail', detail: '6 / 8' },
      PASS('curve'),
    ];
    renderHero({ validation: makeValidation(checks) });
    expect(hasText(/^✗ ?5 to fix$/)).toBe(true);
    // First three named, then "+2 more".
    expect(
      hasText(
        /^Deck size 98 \/ 100 cards, Commander identity 2 off-color cards, Singleton 1 duplicate name \+2 more$/
      )
    ).toBe(true);
  });

  it('shows "N to tune" when there are only soft warnings', () => {
    const checks: ValidationCheck[] = [
      PASS('size'),
      { id: 'removal', label: 'Removal count', status: 'warn', detail: '6 / 8' },
      { id: 'curve', label: 'Curve', status: 'warn', detail: 'Avg MV 3.80' },
    ];
    renderHero({ validation: makeValidation(checks) });
    expect(hasText(/^▾ ?2 to tune$/)).toBe(true);
    expect(hasText(/^Removal count 6 \/ 8, Curve Avg MV 3.80$/)).toBe(true);
  });

  it('renders only the Functional pillar when planScore is null', () => {
    renderHero({ planScore: null });
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
    renderHero({ planScore: plan });
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
    renderHero({ planScore: plan });
    expect(hasText(/soft spot:/)).toBe(false);
  });
});
