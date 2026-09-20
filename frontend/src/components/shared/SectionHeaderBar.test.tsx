// @vitest-environment happy-dom
/**
 * The group divider shared by Collection's grouped list and a binder's table.
 *
 * It carries two slots because the two surfaces genuinely differ: a binder is
 * headed by the real mana symbol rather than a colour swatch, and it counts
 * both cards and distinct printings. Everything else — the disclosure
 * semantics above all — has to stay identical, which is the reason the bar is
 * one component instead of two that drift.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SectionHeaderBar } from './SectionHeaderBar';

const base = {
  label: 'White',
  count: 40,
  collapsed: false,
  onToggle: () => {},
  className: 'collection-list-section-header',
};

describe('the shared section header bar', () => {
  it('shows the plain count and colour dot by default', () => {
    const { container } = render(
      <SectionHeaderBar {...base} pip={{ background: '#fff', border: '#ccc' }} />
    );
    expect(container.querySelector('.collection-list-section-count')?.textContent).toBe('40');
    expect(container.querySelector('.collection-list-section-pip')).toBeTruthy();
  });

  it('lets a surface replace the dot and the count', () => {
    const { container } = render(
      <SectionHeaderBar
        {...base}
        pip={{ background: '#fff', border: '#ccc' }}
        pipSlot={<span data-testid="mana" />}
        meta="40 cards · 29 unique"
      />
    );
    expect(screen.getByTestId('mana')).toBeTruthy();
    // The slot REPLACES the swatch rather than adding a second pip.
    expect(container.querySelector('.collection-list-section-pip')).toBeNull();
    expect(container.querySelector('.collection-list-section-count')?.textContent).toBe(
      '40 cards · 29 unique'
    );
  });

  it('keeps the count in the accessible name even when meta replaces it', () => {
    // A screen reader still needs the number; "40 cards · 29 unique" is a
    // visual nicety, not the semantic count.
    render(<SectionHeaderBar {...base} meta="40 cards · 29 unique" />);
    expect(screen.getByRole('button', { name: 'White, 40 cards, expanded' })).toBeTruthy();
  });

  it('reports the collapsed state both ways', () => {
    const { container } = render(<SectionHeaderBar {...base} collapsed />);
    const btn = screen.getByRole('button', { name: 'White, 40 cards, collapsed' });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(
      container.querySelector('.collection-section-chevron')?.getAttribute('data-collapsed')
    ).toBe('true');
  });

  it('wires itself to the region it discloses when asked', () => {
    render(<SectionHeaderBar {...base} id="hdr-w" controls="panel-w" />);
    const btn = screen.getByRole('button');
    expect(btn.id).toBe('hdr-w');
    expect(btn.getAttribute('aria-controls')).toBe('panel-w');
  });

  it('toggles on click', () => {
    const onToggle = vi.fn();
    render(<SectionHeaderBar {...base} onToggle={onToggle} />);
    screen.getByRole('button').click();
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
