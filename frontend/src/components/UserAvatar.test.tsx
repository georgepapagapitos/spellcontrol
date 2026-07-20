// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { UserAvatar, contrastRatio, fallbackTextColor } from './UserAvatar';
import { PRESET_COLORS } from '../lib/preset-colors';

describe('UserAvatar', () => {
  it('renders the image when imageUrl is set', () => {
    const { container } = render(
      <UserAvatar imageUrl="https://cards.scryfall.io/art_crop/front/x.jpg" name="Sol Ring" />
    );
    const img = container.querySelector('img.user-avatar-img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('https://cards.scryfall.io/art_crop/front/x.jpg');
    // Decorative — the accessible name comes from the wrapping control/text.
    expect(img?.getAttribute('alt')).toBe('');
    expect(container.querySelector('.user-avatar-fallback')).toBeNull();
  });

  it('renders the initial-letter fallback when imageUrl is null', () => {
    const { container, getByText } = render(<UserAvatar imageUrl={null} name="Sol Ring" />);
    expect(container.querySelector('img')).toBeNull();
    const fallback = container.querySelector('.user-avatar-fallback');
    expect(fallback).not.toBeNull();
    expect(fallback?.getAttribute('aria-hidden')).toBe('true');
    expect(getByText('S')).toBeTruthy();
  });

  it('uppercases the initial from a lowercase name', () => {
    const { getByText } = render(<UserAvatar imageUrl={undefined} name="sol ring" />);
    expect(getByText('S')).toBeTruthy();
  });

  it('same name always yields the same fill color (determinism)', () => {
    const a = render(<UserAvatar imageUrl={null} name="Consistent Name" />);
    const b = render(<UserAvatar imageUrl={null} name="Consistent Name" />);
    const colorA = (a.container.querySelector('.user-avatar-fallback') as HTMLElement).style
      .backgroundColor;
    const colorB = (b.container.querySelector('.user-avatar-fallback') as HTMLElement).style
      .backgroundColor;
    expect(colorA).not.toBe('');
    expect(colorA).toBe(colorB);
  });

  it('different names can yield different fill colors', () => {
    const names = Array.from({ length: 30 }, (_, i) => `Card Name ${i}`);
    const colors = new Set(
      names.map((name) => {
        const { container } = render(<UserAvatar imageUrl={null} name={name} />);
        return (container.querySelector('.user-avatar-fallback') as HTMLElement).style
          .backgroundColor;
      })
    );
    // Not asserting a specific count (hash distribution isn't the point) —
    // just that the palette isn't collapsing to a single color for everyone.
    expect(colors.size).toBeGreaterThan(1);
  });

  it('fallback text color meets WCAG AA contrast (4.5:1) against every palette background', () => {
    for (const { hex, name } of PRESET_COLORS) {
      const textColor = fallbackTextColor(hex);
      const ratio = contrastRatio(hex, textColor);
      expect(ratio, `${name} (${hex}) contrast with ${textColor}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
