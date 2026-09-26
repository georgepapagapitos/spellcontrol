// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicDeck } from '../../lib/shared-types';

const copySharedDeckMock = vi.fn((_data: PublicDeck, _token?: string) => 'new-deck-id');
vi.mock('../../lib/copy-shared-deck', () => ({
  copySharedDeck: (data: PublicDeck, token?: string) => copySharedDeckMock(data, token),
}));

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const real = await importOriginal<typeof import('react-router-dom')>();
  return { ...real, useNavigate: () => navigateMock };
});

import { CopyDeckButton } from './CopyDeckButton';

function deck(): PublicDeck {
  return {
    ownerUsername: 'alex',
    ownerDisplayName: null,
    id: 'd1',
    name: 'Korvold Treasure',
    format: 'commander',
    commander: null,
    partnerCommander: null,
    cards: [],
    sideboard: [],
    color: '#7c3aed',
  };
}

beforeEach(() => {
  copySharedDeckMock.mockClear();
  navigateMock.mockClear();
});

function renderButton(slug?: string) {
  return render(
    <MemoryRouter>
      <CopyDeckButton data={deck()} slug={slug} />
    </MemoryRouter>
  );
}

describe('CopyDeckButton', () => {
  it('stamps the copy with the public deck it came from (copying from /d/:slug)', () => {
    renderButton('korvold-treasure');
    fireEvent.click(screen.getByRole('button'));
    expect(copySharedDeckMock).toHaveBeenCalledWith(deck(), 'korvold-treasure');
    expect(navigateMock).toHaveBeenCalledWith('/decks/new-deck-id', {
      state: { promptVisibility: true },
    });
  });

  it('copies without lineage from a share link (copying from /s/:token)', () => {
    renderButton(undefined);
    fireEvent.click(screen.getByRole('button'));
    expect(copySharedDeckMock).toHaveBeenCalledWith(deck(), undefined);
    expect(navigateMock).toHaveBeenCalledWith('/decks/new-deck-id', {
      state: { promptVisibility: true },
    });
  });

  it('sends no counter request of its own: the copy counts once it syncs', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderButton('korvold-treasure');
    fireEvent.click(screen.getByRole('button'));
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
