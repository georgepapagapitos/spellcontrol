// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DeckHero } from './DeckHero';

describe('DeckHero', () => {
  it('opens the meta line with the deck colors in WUBRG order, named once', () => {
    // A partner pair merges identities in any order; the pips read WUBRG.
    render(<DeckHero title={<h1>Odds and Ends</h1>} meta="Commander" colors={['B', 'W', 'U']} />);
    const pips = screen.getByRole('img', { name: 'Colors: white, blue, black' });
    expect(pips.closest('.binder-hero-meta')).toBeTruthy();
    expect(pips.querySelectorAll('i')).toHaveLength(3);
  });

  it('shows no pips for a colorless or non-commander deck', () => {
    const { container } = render(
      <DeckHero title={<h1>Artifacts</h1>} meta="Commander" colors={[]} />
    );
    expect(container.querySelector('.deck-hero-colors')).toBeNull();
  });

  it('draws the commander art as a thumbnail beside the title column', () => {
    const { container } = render(
      <DeckHero title={<h1>Odds and Ends</h1>} meta="Commander" art="https://x/art.jpg" />
    );
    const hero = container.querySelector('header.deck-editor-hero--art')!;
    // Thumbnail first, then the column: a sibling, not a backdrop behind it.
    expect(hero.firstElementChild?.className).toBe('deck-editor-hero-art');
    expect(hero.children[1]?.className).toBe('deck-editor-hero-text');
  });
});
