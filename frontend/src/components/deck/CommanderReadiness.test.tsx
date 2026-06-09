// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CommanderReadiness } from './CommanderReadiness';
import type { ReadinessScore } from '../../lib/commander-readiness';

function score(p: Partial<ReadinessScore> = {}): ReadinessScore {
  return {
    available: true,
    ownedCount: 1,
    totalCount: 100,
    percent: 1,
    explainerLine: 'You own 1 of Atraxa’s top 100 staples',
    ownedSamples: [],
    ...p,
  };
}

describe('CommanderReadiness', () => {
  it('renders a loading skeleton when the score is undefined', () => {
    const { container } = render(<CommanderReadiness score={undefined} />);
    expect(container.querySelector('.cmdr-readiness.is-loading')).not.toBeNull();
  });

  it('renders an unavailable note (no bar) when readiness is unavailable', () => {
    render(
      <CommanderReadiness score={score({ available: false, explainerLine: 'Unavailable' })} />
    );
    expect(screen.getByText('Unavailable')).toBeTruthy();
    expect(screen.queryByText('1%')).toBeNull();
  });

  it('renders the percent and explainer when available', () => {
    render(
      <CommanderReadiness
        score={score({
          percent: 47,
          ownedCount: 47,
          explainerLine: 'You own 47 of 100 top staples',
        })}
      />
    );
    expect(screen.getByText('47%')).toBeTruthy();
    expect(screen.getByText(/You own 47/)).toBeTruthy();
  });

  it('surfaces owned staples behind the info affordance', () => {
    render(
      <CommanderReadiness
        score={score({ ownedCount: 5, ownedSamples: ['Sol Ring', 'Arcane Signet', 'Cultivate'] })}
      />
    );
    expect(screen.getByRole('button', { name: 'What is readiness?' })).toBeTruthy();
  });

  it('omits the info affordance when no owned staples are known', () => {
    render(<CommanderReadiness score={score({ ownedCount: 0, ownedSamples: [] })} />);
    expect(screen.queryByRole('button', { name: 'What is readiness?' })).toBeNull();
  });
});
