// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FoilBadge } from './FoilBadge';

describe('FoilBadge', () => {
  it('renders nothing for a non-foil card', () => {
    const { container } = render(<FoilBadge card={{ foil: false }} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders an accessible pip for a regular foil (no double "Foil foil")', () => {
    render(<FoilBadge card={{ foil: true }} />);
    expect(screen.getByRole('img', { name: 'Foil' })).toBeTruthy();
  });

  it('tints the etched finish and names it in the accessible label', () => {
    const { container } = render(<FoilBadge card={{ foil: true, finishes: ['etched'] }} />);
    expect(container.querySelector('.foil-badge.foil-etched')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Etched foil' })).toBeTruthy();
  });

  it('maps promo treatments (oilslick) to their shared palette class', () => {
    const { container } = render(<FoilBadge card={{ foil: true, promoTypes: ['oilslick'] }} />);
    expect(container.querySelector('.foil-badge.foil-oilslick')).toBeTruthy();
  });
});
