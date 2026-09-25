// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CubeChooserPage } from './CubeChooserPage';

describe('CubeChooserPage — the three starts', () => {
  it('links each tile to its own start, never a segmented toggle', () => {
    render(
      <MemoryRouter>
        <CubeChooserPage />
      </MemoryRouter>
    );
    const collection = screen.getByRole('link', { name: /From my collection/ });
    expect(collection.getAttribute('href')).toBe('/decks/cube/new/collection');
    const importLink = screen.getByRole('link', { name: /Import a cube/ });
    expect(importLink.getAttribute('href')).toBe('/decks/cube/new/import');
    const friends = screen.getByRole('link', { name: /With friends/ });
    expect(friends.getAttribute('href')).toBe('/decks/cube/new/friends');
  });

  it('the back link returns to the cube list', () => {
    render(
      <MemoryRouter>
        <CubeChooserPage />
      </MemoryRouter>
    );
    const back = screen.getByRole('link', { name: /Cubes/ });
    expect(back.getAttribute('href')).toBe('/decks/cube');
  });
});
