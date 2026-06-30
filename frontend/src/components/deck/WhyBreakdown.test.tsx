// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { WhyBreakdown } from './WhyBreakdown';
import type { WhyFactor } from '@/lib/why-factors';

const FACTORS: WhyFactor[] = [
  { text: 'Already in your collection — no purchase', tone: 'pro' },
  { text: 'Not in your collection yet', tone: 'con' },
  { text: 'Same Ramp role — your curve and counts hold', tone: 'neutral' },
];

describe('WhyBreakdown', () => {
  it('renders nothing when there are no factors', () => {
    const { container } = render(<WhyBreakdown factors={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('is collapsed by default and toggles aria-expanded + the factor list', () => {
    render(<WhyBreakdown factors={FACTORS} label="Why cut this?" />);
    const toggle = screen.getByRole('button', { name: 'Why cut this?' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // Factor text is not in the DOM while collapsed.
    expect(screen.queryByText(FACTORS[0].text)).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    for (const f of FACTORS) expect(screen.getByText(f.text)).toBeTruthy();

    // The list the button controls actually exists with the wired id.
    expect(toggle.getAttribute('aria-controls')).toBe(screen.getByRole('list').id);

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('tags each factor with its tone for the colored dot', () => {
    render(<WhyBreakdown factors={FACTORS} />);
    fireEvent.click(screen.getByRole('button'));
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.getAttribute('data-tone'))).toEqual(['pro', 'con', 'neutral']);
  });
});
