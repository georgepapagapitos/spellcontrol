// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FitSignal } from './CardSearchPanel';
import type { GapAnalysisCard } from '@/deck-builder/types';

// CardSearchPanel.tsx has no dedicated test file today (52KB+, heavy store/
// service surface) — this is a minimal, targeted addition covering FitSignal's
// new "N on SpellControl" branch, not a comprehensive backfill of the panel.
// See w4-commander-popularity-stat spec's Tests/Coverage note.

function gap(overrides: Partial<GapAnalysisCard> = {}): GapAnalysisCard {
  return {
    name: 'Sol Ring',
    price: null,
    inclusion: 45,
    synergy: 0,
    typeLine: 'Artifact',
    ...overrides,
  };
}

describe('FitSignal', () => {
  it('renders nothing when there is no gap, roleLabel, or combo data', () => {
    const { container } = render(<FitSignal />);
    expect(container.textContent).toBe('');
  });

  it('shows only the EDHREC pct when the card is not in the commander topCards list', () => {
    render(<FitSignal gap={gap()} />);
    expect(screen.getByText(/45% EDHREC/)).toBeTruthy();
    expect(screen.queryByText(/on SpellControl/)).toBeNull();
    const wrapper = screen.getByText(/45% EDHREC/).closest('span');
    expect(wrapper?.getAttribute('aria-label')).toBe(
      'Included in 45% of EDHREC decks with this commander'
    );
  });

  it('appends the SpellControl count when the card IS in the topCards list', () => {
    render(<FitSignal gap={gap()} platformCount={12} />);
    expect(screen.getByText(/45% EDHREC/)).toBeTruthy();
    expect(screen.getByText(/12 on SpellControl/)).toBeTruthy();
    const wrapper = screen.getByText(/45% EDHREC/).closest('span');
    expect(wrapper?.getAttribute('aria-label')).toBe(
      'Included in 45% of EDHREC decks with this commander, 12 on SpellControl'
    );
  });

  it('never shows a dangling trailing comma when platformCount is absent', () => {
    render(<FitSignal gap={gap({ inclusion: 8 })} />);
    const wrapper = screen.getByText(/8% EDHREC/).closest('span');
    expect(wrapper?.getAttribute('aria-label')).toBe(
      'Included in 8% of EDHREC decks with this commander'
    );
    expect(wrapper?.getAttribute('aria-label')).not.toMatch(/,\s*$/);
  });

  it('ignores platformCount for an off-meta (< 1%) or missing gap — the SpellControl count only ever appends to a real EDHREC pct', () => {
    const { container: offmeta } = render(
      <FitSignal gap={gap({ inclusion: 0 })} platformCount={12} />
    );
    expect(offmeta.textContent).not.toContain('SpellControl');

    const { container: noGap } = render(<FitSignal platformCount={12} />);
    expect(noGap.textContent).not.toContain('SpellControl');
  });

  it('keeps roleLabel and combo produces text alongside the new fragment', () => {
    const { container } = render(
      <FitSignal gap={gap({ roleLabel: 'Ramp' })} platformCount={12} produces="Infinite mana" />
    );
    const text = container.textContent ?? '';
    expect(text).toContain('Ramp');
    expect(text).toContain('Completes: Infinite mana');
  });
});
