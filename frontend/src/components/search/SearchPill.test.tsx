// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SearchPill } from './SearchPill';

/**
 * E313: the pill's wrapper is a plain <div> with no handler, so the magnifier
 * and the pill's left padding — the most natural place to tap a search field —
 * did nothing at all. Measured at the phone tier, then fixed by making the
 * icon a <label> for the input, which forwards the tap with no JS; the
 * stylesheet stretches that label over the padding and the pill's full height
 * (guarded in styles/touch-target-overlap.test.ts's siblings).
 */
describe('SearchPill', () => {
  it('the magnifier is a label wired to the input', () => {
    const { container } = render(<SearchPill value="" onChange={() => {}} placeholder="Search" />);
    const input = screen.getByPlaceholderText('Search');
    const label = container.querySelector('label.search-pill-icon-label');
    expect(label, 'the icon must be a <label>, not a decorative span').toBeTruthy();
    expect(input.id, 'the input needs an id for the label to point at').toBeTruthy();
    expect(label!.getAttribute('for')).toBe(input.id);
  });

  it("a caller's own input id still wins, so focus-by-id keeps working", () => {
    const { container } = render(
      <SearchPill value="" onChange={() => {}} placeholder="Search" inputId="card-search" />
    );
    expect(screen.getByPlaceholderText('Search').id).toBe('card-search');
    expect(container.querySelector('label.search-pill-icon-label')!.getAttribute('for')).toBe(
      'card-search'
    );
  });

  it('two pills on one page get distinct ids', () => {
    // useId, not a module-level counter — two labels pointing at one input
    // would send every tap to the first pill.
    const { container } = render(
      <>
        <SearchPill value="" onChange={() => {}} placeholder="One" />
        <SearchPill value="" onChange={() => {}} placeholder="Two" />
      </>
    );
    const ids = [...container.querySelectorAll('input')].map((i) => i.id);
    expect(new Set(ids).size).toBe(2);
  });
});
