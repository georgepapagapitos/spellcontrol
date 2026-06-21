// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { RarityBadge } from './RarityBadge';

function chip(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[role="img"]');
  if (!el) throw new Error('no chip rendered');
  return el as HTMLElement;
}

describe('RarityBadge', () => {
  it('shows the rarity letter and an accessible name (not color alone)', () => {
    const cases: Array<[string, string, string]> = [
      ['common', 'C', 'Common'],
      ['uncommon', 'U', 'Uncommon'],
      ['rare', 'R', 'Rare'],
      ['mythic', 'M', 'Mythic'],
    ];
    for (const [rarity, letter, label] of cases) {
      const { container } = render(<RarityBadge rarity={rarity} />);
      const el = chip(container);
      expect(el.textContent).toBe(letter);
      expect(el.getAttribute('aria-label')).toBe(label);
      expect(el.getAttribute('title')).toBe(label);
      expect(el.className).toContain(`rarity-badge--${rarity}`);
    }
  });

  it('folds missing/unknown rarities to common', () => {
    const { container: none } = render(<RarityBadge />);
    expect(chip(none).textContent).toBe('C');
    const { container: special } = render(<RarityBadge rarity="special" />);
    expect(chip(special).textContent).toBe('C');
  });

  it('passes className through for per-surface placement', () => {
    const { container } = render(<RarityBadge rarity="rare" className="collection-grid-rarity" />);
    expect(chip(container).className).toContain('collection-grid-rarity');
  });
});
