// @vitest-environment happy-dom
import { render, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EnginePanel } from './EnginePanel';
import type { SynergyAnalysis } from '@/deck-builder/services/synergy/analysis';
import type { AxisSummary } from '@/deck-builder/services/synergy/deckSynergy';
import type { ScryfallCard } from '@/deck-builder/types';

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

// ── Tappable axis drill-through (E60) ──────────────────────────────────────

const axisSummaries: AxisSummary[] = [
  {
    axis: 'tokens',
    label: 'Tokens',
    total: 10,
    producers: [
      { name: 'Avenger of Zendikar', reason: 'creates plant tokens' },
      { name: 'Tendershoot Dryad', reason: 'creates saproling tokens' },
    ],
    payoffs: [{ name: 'Parallel Lives', reason: 'doubles tokens created' }],
  },
  {
    axis: 'sacrifice',
    label: 'Sacrifice',
    total: 2,
    producers: [{ name: "Ashnod's Altar", reason: 'sac outlet for mana' }],
    payoffs: [{ name: 'Grave Pact', reason: 'triggers on your creature death' }],
  },
];

const allCards: ScryfallCard[] = [
  { name: 'Avenger of Zendikar', type_line: 'Creature' } as unknown as ScryfallCard,
  { name: 'Tendershoot Dryad', type_line: 'Creature' } as unknown as ScryfallCard,
  { name: 'Parallel Lives', type_line: 'Enchantment' } as unknown as ScryfallCard,
  { name: "Ashnod's Altar", type_line: 'Artifact' } as unknown as ScryfallCard,
  { name: 'Grave Pact', type_line: 'Enchantment' } as unknown as ScryfallCard,
];

describe('EnginePanel tappable axis rows (E60)', () => {
  it('renders axis rows as buttons when axisSummaries + allCards provided', () => {
    const { container } = render(
      <EnginePanel
        analysis={analysis()}
        onAdd={() => {}}
        showSuggestions={false}
        axisSummaries={axisSummaries}
        allCards={allCards}
      />
    );
    const btns = container.querySelectorAll('.engine-axis-btn');
    // Two non-zero axes (Mill filtered out) → two buttons
    expect(btns.length).toBe(2);
    expect(btns[0].getAttribute('aria-label')).toContain('Tokens');
    expect(btns[1].getAttribute('aria-label')).toContain('Sacrifice');
  });

  it('axis rows are NOT buttons when axisSummaries is absent', () => {
    const { container } = render(
      <EnginePanel analysis={analysis()} onAdd={() => {}} showSuggestions={false} />
    );
    expect(container.querySelectorAll('.engine-axis-btn').length).toBe(0);
  });

  it('tapping an axis row opens a CardGroupSheet dialog', () => {
    const { container } = render(
      <EnginePanel
        analysis={analysis()}
        onAdd={() => {}}
        showSuggestions={false}
        axisSummaries={axisSummaries}
        allCards={allCards}
      />
    );
    const tokensBtn = container.querySelector('.engine-axis-btn') as HTMLButtonElement;
    fireEvent.click(tokensBtn);
    // CardGroupSheet portals to document.body
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    // Sheet title matches the axis label
    expect(document.body.querySelector('.card-group-title')?.textContent).toBe('Tokens');
  });

  it('keyboard Enter on an axis row opens the CardGroupSheet', () => {
    const { container } = render(
      <EnginePanel
        analysis={analysis()}
        onAdd={() => {}}
        showSuggestions={false}
        axisSummaries={axisSummaries}
        allCards={allCards}
      />
    );
    const tokensBtn = container.querySelector('.engine-axis-btn') as HTMLButtonElement;
    fireEvent.keyDown(tokensBtn, { key: 'Enter' });
    fireEvent.click(tokensBtn); // button fires click on Enter natively; simulate via click
    expect(document.body.querySelector('[role="dialog"]')).toBeTruthy();
  });

  it('the opened sheet shows Producer and Payoff annotation chips', () => {
    const { container } = render(
      <EnginePanel
        analysis={analysis()}
        onAdd={() => {}}
        showSuggestions={false}
        axisSummaries={axisSummaries}
        allCards={allCards}
      />
    );
    fireEvent.click(container.querySelector('.engine-axis-btn') as HTMLButtonElement);
    // Default grid layout → annotation overlays present
    const chips = Array.from(
      document.body.querySelectorAll('.card-group-annotation .verdict-chip')
    ).map((el) => el.textContent);
    expect(chips).toContain('Producer');
    expect(chips).toContain('Payoff');
  });
});
