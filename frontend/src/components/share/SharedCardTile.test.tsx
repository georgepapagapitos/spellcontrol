// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SharedCardTile } from './SharedCardTile';
import type { PublicCard } from '@/lib/social/shared-types';

// The tile resolves art by name through the card cache when the projection
// carries no image; the network is not the subject here.
vi.mock('@/lib/cards/card-thumbs', () => ({ useCardThumb: () => undefined }));

function pc(over: Partial<PublicCard> = {}): PublicCard {
  return {
    name: 'Sol Ring',
    oracleId: 'o-sol',
    scryfallId: 'sf-sol',
    setCode: 'cmr',
    setName: 'Commander Legends',
    collectorNumber: '472',
    rarity: 'uncommon',
    finish: 'nonfoil',
    foil: false,
    purchasePrice: 3.5,
    cmc: 1,
    typeLine: 'Artifact',
    colors: [],
    colorIdentity: [],
    ...over,
  } as PublicCard;
}

describe('SharedCardTile', () => {
  it('renders the app-wide grid cell, so shared views match the owner’s collection', () => {
    // The whole point of the component: it is an adapter over CardGridCell,
    // not a second tile implementation. If someone reintroduces bespoke
    // markup here, the shared views start drifting from /collection again.
    render(<SharedCardTile card={pc()} quantity={2} onClick={() => {}} />);
    const tile = screen.getByRole('button', { name: /sol ring/i });
    expect(tile.closest('.collection-grid-item')).not.toBeNull();
  });

  it('captions the price and the ×qty chip by default', () => {
    const { container } = render(<SharedCardTile card={pc()} quantity={2} onClick={() => {}} />);
    expect(container.textContent).toContain('$3.50');
    expect(container.textContent).toContain('2');
    expect(screen.getByRole('button', { name: /quantity 2/i })).toBeTruthy();
  });

  it('with hideValue says nothing about price OR count — including in the accessible name', () => {
    // The friend-collection contract ("contents yes, value no"). Its
    // projection carries purchasePrice 0, which would caption as "$0.00", and
    // CardGridCell states "quantity N" unconditionally.
    const { container } = render(
      <SharedCardTile card={pc({ purchasePrice: 0 })} quantity={3} onClick={() => {}} hideValue />
    );
    expect(container.textContent).not.toMatch(/\$/);
    expect(container.textContent).not.toMatch(/3/);
    expect(
      screen.getByRole('button', { name: /sol ring/i }).getAttribute('aria-label')
    ).not.toMatch(/quantity/i);
  });

  it('captions only the rarity word when the projection carries no printing identity', () => {
    // The friend endpoint is oracle-level: no set code, no collector number.
    // `gridSetLabel` would otherwise caption that as an empty line.
    const { container } = render(
      <SharedCardTile
        card={pc({ setCode: '', collectorNumber: '' })}
        onClick={() => {}}
        hideValue
      />
    );
    expect(container.querySelector('.collection-grid-caption--set')?.textContent).toBe('Uncommon');
    expect(container.querySelector('.ss')).toBeNull();
  });

  it('never puts the rarity chip on the art, where it covers the printed mana cost', () => {
    // Friend tiles (no set code) and share tiles with the set caption off both
    // used to pin a C/U/R/M chip top-right, over the mana cost.
    localStorage.setItem(
      'mtg-collection-grid-caption-prefs',
      JSON.stringify({ sortValue: true, set: false })
    );
    try {
      const { container } = render(<SharedCardTile card={pc()} onClick={() => {}} />);
      expect(container.querySelector('.rarity-badge')).toBeNull();
      expect(container.querySelector('.collection-grid-topright')).toBeNull();
    } finally {
      localStorage.clear();
    }
    const friend = render(
      <SharedCardTile
        card={pc({ setCode: '', collectorNumber: '' })}
        onClick={() => {}}
        hideValue
      />
    );
    expect(friend.container.querySelector('.rarity-badge')).toBeNull();
  });

  it('states a spare copy in visible words, in the caption and the accessible name', () => {
    const { container } = render(<SharedCardTile card={pc()} onClick={() => {}} hideValue spare />);
    expect(container.querySelector('.collection-grid-caption--note')?.textContent).toBe(
      'Spare copy'
    );
    expect(container.querySelector('.art-badge')).toBeNull();
    expect(screen.getByRole('button', { name: /spare copy/i })).toBeTruthy();
  });

  it('says nothing about a spare when there is none', () => {
    const { container } = render(<SharedCardTile card={pc()} onClick={() => {}} hideValue />);
    expect(container.querySelector('.collection-grid-caption--note')).toBeNull();
  });

  it('keeps the card name on the tile while its art has not painted', () => {
    // A resolved art URL is not a painted image: a lazy <img> is blank until
    // it loads, which left wide friend grids as walls of empty boxes.
    const { container } = render(
      <SharedCardTile
        card={pc({ imageNormal: 'https://img.test/sol.jpg' } as never)}
        onClick={() => {}}
        hideValue
      />
    );
    const ph = container.querySelector('.collection-grid-placeholder.is-pending');
    expect(ph?.textContent).toBe('Sol Ring');
    fireEvent.load(container.querySelector('img')!);
    expect(container.querySelector('.collection-grid-placeholder')).toBeNull();
  });

  it('shows the name when there is no art at all', () => {
    const { container } = render(<SharedCardTile card={pc()} onClick={() => {}} hideValue />);
    expect(container.querySelector('.collection-grid-placeholder')?.textContent).toBe('Sol Ring');
  });
});
