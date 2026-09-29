// @vitest-environment happy-dom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ColorIdentityBar } from './ColorIdentityBar';

const segs = (container: HTMLElement) =>
  [...container.querySelectorAll('.color-identity-bar-seg')].map((s) =>
    s.className.replace(/.*--/, '')
  );

describe('ColorIdentityBar', () => {
  it('draws one segment per color, in the order given', () => {
    const { container } = render(<ColorIdentityBar colors={['G', 'B', 'R']} />);
    expect(segs(container)).toEqual(['g', 'b', 'r']);
  });

  it('draws one neutral segment for a colorless deck', () => {
    const { container } = render(<ColorIdentityBar colors={[]} />);
    expect(segs(container)).toEqual(['c']);
  });

  it('is hidden from assistive tech (the pips and label carry the colors)', () => {
    const { container } = render(<ColorIdentityBar colors={['W']} />);
    expect(container.querySelector('.color-identity-bar')?.getAttribute('aria-hidden')).toBe(
      'true'
    );
  });
});
