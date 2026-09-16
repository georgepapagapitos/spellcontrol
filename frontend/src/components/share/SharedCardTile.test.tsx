// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SharedCardTile } from './SharedCardTile';
import type { PublicCard } from '../../lib/shared-types';

// The tile resolves art by name through the card cache when the projection
// carries no image; the network is not the subject here.
vi.mock('../../lib/card-thumbs', () => ({ useCardThumb: () => undefined }));

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
    expect(tile.className).toContain('collection-grid-item');
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

  it('omits the set caption when the projection carries no printing identity', () => {
    // The friend endpoint is oracle-level: no set code, no collector number.
    // `gridSetLabel` would otherwise caption that as an empty line.
    const { container } = render(
      <SharedCardTile
        card={pc({ setCode: '', collectorNumber: '' })}
        onClick={() => {}}
        hideValue
      />
    );
    expect(container.querySelector('.collection-grid-caption--set')).toBeNull();
  });
});
