// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { FilterSection } from './FilterSection';

describe('FilterSection', () => {
  it('is a region named by its heading, with the count spoken in the heading', () => {
    render(
      <FilterSection label="Rarity" count={2}>
        <p>body</p>
      </FilterSection>
    );
    expect(screen.getByRole('region', { name: /Rarity/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Rarity 2 selected' })).toBeTruthy();
  });

  it('shows no count at zero', () => {
    render(
      <FilterSection label="Rarity">
        <p>body</p>
      </FilterSection>
    );
    expect(screen.getByRole('heading', { name: 'Rarity' })).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('uses the shared sentence-case section heading, not a caps stamp (E595)', () => {
    render(
      <FilterSection label="Rarity">
        <p>body</p>
      </FilterSection>
    );
    expect(screen.getByRole('heading', { name: 'Rarity' }).className).toContain(
      'form-section-heading'
    );
    const css = readFileSync(join(__dirname, 'filter-kit.css'), 'utf8');
    expect(css).not.toMatch(/text-transform:\s*uppercase/);
    expect(css).not.toMatch(/--font-label/);
  });
});
