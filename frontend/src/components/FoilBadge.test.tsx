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

  it('classifies the etched finish and labels it', () => {
    render(<FoilBadge card={{ foil: true, finishes: ['etched'] }} showLabel />);
    expect(screen.getByText('Etched')).toBeTruthy();
    expect(screen.getByText('Etched foil')).toBeTruthy(); // sr-only
  });

  it('maps promo treatments (oilslick) to their shared palette class', () => {
    const { container } = render(<FoilBadge card={{ foil: true, promoTypes: ['oilslick'] }} />);
    expect(container.querySelector('.foil-badge.foil-oilslick')).toBeTruthy();
  });
});
