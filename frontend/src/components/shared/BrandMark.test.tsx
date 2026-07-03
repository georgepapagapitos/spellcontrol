// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { BrandMark } from './BrandMark';

function svg(container: HTMLElement): SVGSVGElement {
  const el = container.querySelector('svg');
  if (!el) throw new Error('no svg rendered');
  return el as SVGSVGElement;
}

describe('BrandMark', () => {
  it('renders the static mark with no motion elements when motion is unset', () => {
    const { container } = render(<BrandMark />);
    const el = svg(container);
    expect(el.getAttribute('class')).toBe('brand-mark');
    expect(el.querySelectorAll('.brand-mark-aura')).toHaveLength(0);
    expect(el.querySelectorAll('.brand-mark-seal-glow')).toHaveLength(0);
    expect(el.querySelectorAll('.brand-mark-gem')).toHaveLength(0);
    // the plain clasp diamond is always present
    expect(el.querySelectorAll('rect[transform="rotate(45 256 287)"]')).toHaveLength(1);
  });

  it('passes size and aria-hidden through unchanged', () => {
    const { container } = render(<BrandMark size={64} aria-hidden className="my-mark" />);
    const el = svg(container);
    expect(el.getAttribute('width')).toBe('64');
    expect(el.getAttribute('height')).toBe('64');
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.getAttribute('class')).toBe('brand-mark my-mark');
  });

  it('idle mode renders the mode class + aura glow elements', () => {
    const { container } = render(<BrandMark motion="idle" />);
    const el = svg(container);
    expect(el.classList.contains('brand-mark-idle')).toBe(true);
    expect(el.querySelectorAll('.brand-mark-aura')).toHaveLength(1);
    expect(el.querySelectorAll('.brand-mark-aura-core')).toHaveLength(1);
    expect(el.querySelectorAll('.brand-mark-clasp-glow')).toHaveLength(1);
    expect(el.querySelectorAll('.brand-mark-gem')).toHaveLength(0);
  });

  it('busy mode renders the mode class + seal glow/highlight/ring elements', () => {
    const { container } = render(<BrandMark motion="busy" />);
    const el = svg(container);
    expect(el.classList.contains('brand-mark-busy')).toBe(true);
    expect(el.querySelectorAll('.brand-mark-seal-glow')).toHaveLength(1);
    expect(el.querySelectorAll('.brand-mark-seal-highlight')).toHaveLength(1);
    expect(el.querySelectorAll('.brand-mark-seal-ring')).toHaveLength(1);
    expect(el.querySelectorAll('.brand-mark-aura')).toHaveLength(0);
  });

  it('boot mode renders the mode class + socket, orbiting gem + trails, and ring', () => {
    const { container } = render(<BrandMark motion="boot" />);
    const el = svg(container);
    expect(el.classList.contains('brand-mark-boot')).toBe(true);
    expect(el.querySelectorAll('.brand-mark-boot-socket')).toHaveLength(1);
    expect(el.querySelectorAll('.brand-mark-gem')).toHaveLength(3);
    expect(el.querySelectorAll('.brand-mark-gem--main')).toHaveLength(1);
    expect(el.querySelectorAll('.brand-mark-gem--trail1')).toHaveLength(1);
    expect(el.querySelectorAll('.brand-mark-gem--trail2')).toHaveLength(1);
    expect(el.querySelectorAll('.brand-mark-orbit-ring')).toHaveLength(1);
    // each gem is carried by a SMIL animateMotion (CSS offset-path mis-anchors on SVG children)
    expect(el.querySelectorAll('.brand-mark-gem > animateMotion')).toHaveLength(3);
    // the plain static clasp is still rendered underneath the socket
    expect(el.querySelectorAll('rect[transform="rotate(45 256 287)"]')).toHaveLength(2);
  });
});
