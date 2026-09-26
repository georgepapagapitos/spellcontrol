// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { useCubeStore, type SavedCube } from '../store/cube';
import type { GeneratedCube } from '../lib/cube/generate';
import { CubeIndexPage } from './CubeIndexPage';

function makeCube(size: 180 | 360 = 180): GeneratedCube {
  return {
    size,
    format: 'limited',
    picks: [],
    byBucket: { W: 0, U: 0, B: 0, R: 0, G: 0, multicolor: 0, colorless: 0, land: 0 },
    targetByBucket: { W: 0, U: 0, B: 0, R: 0, G: 0, multicolor: 0, colorless: 0, land: 0 },
    gaps: [],
    shortfall: 0,
    poolSize: 0,
  };
}

function saved(over: Partial<SavedCube> = {}): SavedCube {
  return {
    id: 'cube-1',
    name: 'Vintage 540',
    size: 180,
    cube: makeCube(180),
    picks: [],
    isPhysical: false,
    savedAt: Date.now(),
    ...over,
  };
}

beforeEach(() => {
  useCubeStore.setState({ size: 540, result: null, loadedId: null, saved: [] });
  localStorage.clear();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <CubeIndexPage />
    </MemoryRouter>
  );
}

describe('CubeIndexPage — rows', () => {
  it('renders a hairline row per saved cube, with its name and meta line', () => {
    useCubeStore.setState({
      saved: [
        saved({ id: 'a', name: 'Vintage 540', size: 180 }),
        saved({ id: 'b', name: 'Modern Goodstuff', size: 360 }),
      ],
    });
    renderPage();
    expect(screen.getByText('Vintage 540')).toBeTruthy();
    expect(screen.getByText('Modern Goodstuff')).toBeTruthy();
    // The meta line reuses SavedCubeMeta's facts: size · players · saved.
    expect(screen.getAllByText(/180 cards/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/players/).length).toBeGreaterThan(0);
  });

  it("opens the cube's own page from a row", () => {
    useCubeStore.setState({ saved: [saved({ id: 'row-id', name: 'Peasant Cube' })] });
    renderPage();
    const link = screen.getByRole('link', { name: /Peasant Cube/ });
    expect(link.getAttribute('href')).toBe('/decks/cube/row-id');
  });

  it('badges a physical cube on its row', () => {
    useCubeStore.setState({ saved: [saved({ isPhysical: true })] });
    renderPage();
    expect(screen.getByText('Physical')).toBeTruthy();
  });

  it('"New cube" primary action links to the chooser', () => {
    useCubeStore.setState({ saved: [saved()] });
    renderPage();
    const link = screen.getByRole('link', { name: /New cube/ });
    expect(link.getAttribute('href')).toBe('/decks/cube/new');
  });
});

describe('CubeIndexPage — empty state', () => {
  it('shows the empty state with a New cube CTA when there are no saved cubes', () => {
    renderPage();
    expect(screen.getByText('Build your first cube.')).toBeTruthy();
    const links = screen.getAllByRole('link', { name: /New cube/ });
    expect(links.some((l) => l.getAttribute('href') === '/decks/cube/new')).toBe(true);
  });
});
