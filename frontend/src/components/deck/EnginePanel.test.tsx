// @vitest-environment happy-dom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EnginePanel } from './EnginePanel';
import type { SynergyAnalysis } from '@/deck-builder/services/synergy/analysis';

function analysis(overrides: Partial<SynergyAnalysis> = {}): SynergyAnalysis {
  return {
    headline: 'Primary engine: Tokens / go-wide (6 producers / 4 payoffs).',
    warnings: [],
    axes: [
      { axis: 'tokens', label: 'Tokens', producers: 6, payoffs: 4 },
      { axis: 'sacrifice', label: 'Sacrifice', producers: 1, payoffs: 1 },
      { axis: 'mill', label: 'Mill', producers: 0, payoffs: 0 },
    ],
    suggestions: [],
    ...overrides,
  };
}

describe('EnginePanel axis balance bars', () => {
  it('sizes each axis bar proportionally to its weight (producers + payoffs)', () => {
    const { container } = render(
      <EnginePanel analysis={analysis()} onAdd={() => {}} showSuggestions={false} />
    );
    const stacks = Array.from(
      container.querySelectorAll('.engine-axis .meterbar-segments')
    ) as HTMLElement[];
    // Zero-weight axes are filtered out entirely.
    expect(stacks.length).toBe(2);
    // Tokens (weight 10) is the busiest axis → spans the full track; Sacrifice
    // (weight 2) spans 20% — NOT the pre-fix full-width-for-everyone painting.
    expect(stacks[0].style.width).toBe('100%');
    expect(stacks[1].style.width).toBe('20%');
  });

  it('splits each bar into producer/payoff segments by their share', () => {
    const { container } = render(
      <EnginePanel analysis={analysis()} onAdd={() => {}} showSuggestions={false} />
    );
    const tokensSegs = Array.from(
      container
        .querySelectorAll('.engine-axis .meterbar-segments')[0]
        .querySelectorAll('.meterbar-seg')
    ) as HTMLElement[];
    expect(tokensSegs.length).toBe(2);
    expect(tokensSegs[0].style.width).toBe('60%');
    expect(tokensSegs[1].style.width).toBe('40%');
  });

  it('keeps the bars decorative — counts are the accessible text', () => {
    const { container, getByText } = render(
      <EnginePanel analysis={analysis()} onAdd={() => {}} showSuggestions={false} />
    );
    const bar = container.querySelector('.engine-axis .meterbar') as HTMLElement;
    expect(bar.getAttribute('aria-hidden')).toBe('true');
    expect(getByText('6 producers')).toBeTruthy();
    expect(getByText('4 payoffs')).toBeTruthy();
  });
});
