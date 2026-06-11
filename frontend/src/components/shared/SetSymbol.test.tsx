// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SetSymbol } from './SetSymbol';

function glyph(container: HTMLElement): HTMLElement {
  const i = container.querySelector('i, [role="img"]');
  if (!i) throw new Error('no glyph rendered');
  return i as HTMLElement;
}

describe('SetSymbol', () => {
  it('renders the keyrune glyph with a rarity tint class, aria-hidden by default', () => {
    const { container } = render(<SetSymbol setCode="MH2" rarity="rare" />);
    const i = glyph(container);
    expect(i.className).toBe('ss ss-mh2 ss-fw set-symbol set-symbol--rare');
    expect(i.getAttribute('aria-hidden')).toBe('true');
  });

  it('maps uncommon and mythic tints', () => {
    const { container: u } = render(<SetSymbol setCode="neo" rarity="uncommon" />);
    expect(glyph(u).className).toContain('set-symbol--uncommon');
    const { container: m } = render(<SetSymbol setCode="neo" rarity="mythic" />);
    expect(glyph(m).className).toContain('set-symbol--mythic');
  });

  it('falls back to the common tint for missing or unknown rarities', () => {
    const { container: none } = render(<SetSymbol setCode="lea" />);
    expect(glyph(none).className).toContain('set-symbol--common');
    const { container: special } = render(<SetSymbol setCode="tsb" rarity="special" />);
    expect(glyph(special).className).toContain('set-symbol--common');
  });

  it('renders nothing when setCode is falsy', () => {
    const { container } = render(<SetSymbol setCode="" rarity="rare" />);
    expect(container.firstChild).toBeNull();
  });

  it('exposes an accessible name + title when title is given', () => {
    const { container } = render(
      <SetSymbol setCode="mh2" rarity="rare" title="Modern Horizons 2 · #225 · rare" />
    );
    const i = glyph(container);
    expect(i.getAttribute('role')).toBe('img');
    expect(i.getAttribute('aria-label')).toBe('Modern Horizons 2 · #225 · rare');
    expect(i.getAttribute('title')).toBe('Modern Horizons 2 · #225 · rare');
  });

  it('passes className through', () => {
    const { container } = render(<SetSymbol setCode="mh2" className="extra" />);
    expect(glyph(container).className).toBe('ss ss-mh2 ss-fw set-symbol set-symbol--common extra');
  });
});
