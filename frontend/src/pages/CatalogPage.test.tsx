// @vitest-environment happy-dom
// The catalog is what the nightly visual diff photographs, so what it must
// keep doing is small and load-bearing: every section is present under its
// stable id (the crop key), the query params drive the real theme and type-set
// stores, it asks crawlers to stay away only while mounted, and it never
// reaches for the network.
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CatalogPage } from './CatalogPage';

const SECTIONS = [
  'button',
  'chip',
  'surface',
  'meter',
  'symbols',
  'form',
  'nav',
  'states',
  'cards',
];

function mount(search = '') {
  window.history.replaceState({}, '', `/dev/catalog${search}`);
  return render(
    <MemoryRouter>
      <CatalogPage />
    </MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CatalogPage', () => {
  it('renders every specimen section under its crop id, each with content', () => {
    const { container } = mount();
    const ids = [...container.querySelectorAll('[data-catalog-section]')].map((n) =>
      n.getAttribute('data-catalog-section')
    );
    expect(ids).toEqual(SECTIONS);
    for (const section of container.querySelectorAll('[data-catalog-section]')) {
      expect(section.querySelector('.catalog-specimen')?.childElementCount).toBeGreaterThan(0);
    }
  });

  it('applies ?theme and ?typeset through the real stores, then reports ready', async () => {
    const { container } = mount('?theme=obsidian&typeset=plain');
    await waitFor(() =>
      expect(container.querySelector('[data-catalog-ready="true"]')).not.toBeNull()
    );
    expect(document.documentElement.getAttribute('data-theme')).toBe('obsidian');
    expect(document.documentElement.getAttribute('data-typeset')).toBe('plain');
  });

  it('ignores an unknown theme or type set instead of throwing', async () => {
    const { container } = mount('?theme=nope&typeset=nope');
    await waitFor(() =>
      expect(container.querySelector('[data-catalog-ready="true"]')).not.toBeNull()
    );
  });

  it('asks crawlers to stay away while mounted and only then', () => {
    const { unmount } = mount();
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toContain(
      'noindex'
    );
    unmount();
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
  });

  it('makes no network request (every card carries its own art)', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    mount();
    vi.unstubAllGlobals();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
