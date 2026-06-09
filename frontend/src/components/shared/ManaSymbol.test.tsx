// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ManaSymbol, ColorPip, TypeIcon } from './ManaSymbol';

function glyph(container: HTMLElement): HTMLElement {
  const i = container.querySelector('i, [role="img"]');
  if (!i) throw new Error('no glyph rendered');
  return i as HTMLElement;
}

describe('ManaSymbol', () => {
  it('renders a bare cost glyph, aria-hidden by default', () => {
    const { container } = render(<ManaSymbol symbol="w" cost />);
    const i = glyph(container);
    expect(i.className).toBe('ms ms-w ms-cost');
    expect(i.getAttribute('aria-hidden')).toBe('true');
  });

  it('adds split + pip + extra classes', () => {
    const { container } = render(<ManaSymbol symbol="2w" cost split pip="lg" className="extra" />);
    expect(glyph(container).className).toBe(
      'ms ms-2w ms-cost ms-split color-pip-mana color-pip-mana--lg extra'
    );
  });

  it('exposes an accessible name + title when label is given', () => {
    const { container } = render(<ManaSymbol symbol="creature" label="Creature" />);
    const i = glyph(container);
    expect(i.getAttribute('role')).toBe('img');
    expect(i.getAttribute('aria-label')).toBe('Creature');
    expect(i.getAttribute('title')).toBe('Creature');
  });

  it('maps the base pip without a size modifier', () => {
    const { container } = render(<ManaSymbol symbol="r" cost pip />);
    expect(glyph(container).className).toBe('ms ms-r ms-cost color-pip-mana');
  });
});

describe('ColorPip', () => {
  it('renders a WUBRG pip with the base pip treatment by default', () => {
    const { container } = render(<ColorPip color="U" />);
    expect(glyph(container).className).toBe('ms ms-u ms-cost color-pip-mana');
  });

  it('honors pip=false for a bare glyph and passes className through', () => {
    const { container } = render(<ColorPip color="B" pip={false} className="deck-combos-pip" />);
    expect(glyph(container).className).toBe('ms ms-b ms-cost deck-combos-pip');
  });

  it('maps multicolor and colorless keys', () => {
    const { container: m } = render(<ColorPip color="M" pip="lg" />);
    expect(glyph(m).className).toContain('ms-multicolor');
    const { container: c } = render(<ColorPip color="C" pip={false} />);
    expect(glyph(c).className).toContain('ms-c');
  });
});

describe('TypeIcon', () => {
  it('renders the primary-type glyph for known types', () => {
    const { container } = render(<TypeIcon type="creature" />);
    expect(glyph(container).className).toBe('ms ms-creature');
  });

  it('falls back to the multiple glyph for unknown/other types', () => {
    const { container } = render(<TypeIcon type="other" />);
    expect(glyph(container).className).toBe('ms ms-multiple');
  });

  it('supports a label + extra className', () => {
    const { container } = render(<TypeIcon type="land" label="Land" className="breakdown-icon" />);
    const i = glyph(container);
    expect(i.className).toBe('ms ms-land breakdown-icon');
    expect(i.getAttribute('aria-label')).toBe('Land');
  });
});
