// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CardThumb } from './CardThumb';

describe('CardThumb', () => {
  it('cross-fades the image in over the skeleton on load (UX-205)', () => {
    const { container } = render(
      <CardThumb className="card-group-img" src="/a.png" alt="Sol Ring" />
    );
    const img = screen.getByAltText('Sol Ring');
    expect(container.querySelector('.card-thumb-skeleton')).toBeTruthy();
    expect(img.classList.contains('is-loaded')).toBe(false);
    fireEvent.load(img);
    // The img fades to opaque via .is-loaded; the skeleton STAYS mounted
    // underneath (so the fade lands on shimmer, not a background flash) and
    // is-settled stops its animation.
    expect(img.classList.contains('is-loaded')).toBe(true);
    expect(container.querySelector('.card-thumb-skeleton.is-settled')).toBeTruthy();
  });

  it('falls back to the card name when the image errors (no broken-img flash)', () => {
    const { container } = render(<CardThumb className="x" src="/missing.png" alt="Black Lotus" />);
    fireEvent.error(screen.getByAltText('Black Lotus'));
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.card-thumb-skeleton')).toBeNull();
    expect(screen.getByText('Black Lotus')).toBeTruthy();
  });

  it('renders decorative thumbs with empty alt + aria-hidden so SRs skip them', () => {
    const { container } = render(<CardThumb className="x" src="/a.png" alt="Island" decorative />);
    const img = container.querySelector('img');
    expect(img?.getAttribute('alt')).toBe('');
    expect(img?.getAttribute('aria-hidden')).toBe('true');
  });

  it('puts the host sizing class on the wrapper alongside .card-thumb', () => {
    const { container } = render(<CardThumb className="product-card-img" src="/a.png" alt="x" />);
    expect(container.querySelector('span.card-thumb.product-card-img')).toBeTruthy();
  });
});
