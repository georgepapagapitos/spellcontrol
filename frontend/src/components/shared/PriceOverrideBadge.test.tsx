// @vitest-environment happy-dom
import { afterEach, describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PriceOverrideBadge } from './PriceOverrideBadge';
import { useCurrencyStore } from '../../lib/currency';

afterEach(() => {
  useCurrencyStore.getState().setCurrency('USD');
});

describe('PriceOverrideBadge', () => {
  it('renders nothing when no override is set', () => {
    const { container } = render(<PriceOverrideBadge card={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders an active chip when the override currency matches the display currency (default USD)', () => {
    const { container } = render(<PriceOverrideBadge card={{ priceOverride: 25 }} />);
    const el = container.querySelector('[role="img"]');
    expect(el).not.toBeNull();
    expect(el!.className).toContain('price-override-badge');
    expect(el!.className).not.toContain('is-dormant');
    expect(el!.getAttribute('aria-label')).toBe('Manually priced');
    expect(el!.getAttribute('title')).toMatch(/overrides Scryfall/i);
  });

  it('renders a dormant chip when the override was recorded in a different currency than the active one', () => {
    useCurrencyStore.getState().setCurrency('EUR');
    const { container } = render(
      <PriceOverrideBadge card={{ priceOverride: 25, priceOverrideCurrency: 'USD' }} />
    );
    const el = container.querySelector('[role="img"]');
    expect(el!.className).toContain('is-dormant');
    expect(el!.getAttribute('aria-label')).toBe('Manually priced in USD');
    expect(el!.getAttribute('title')).toMatch(/switch display currency/i);
  });

  it('renders active when priceOverrideCurrency matches an explicitly non-USD active currency', () => {
    useCurrencyStore.getState().setCurrency('EUR');
    const { container } = render(
      <PriceOverrideBadge card={{ priceOverride: 25, priceOverrideCurrency: 'EUR' }} />
    );
    const el = container.querySelector('[role="img"]');
    expect(el!.className).not.toContain('is-dormant');
  });
});
