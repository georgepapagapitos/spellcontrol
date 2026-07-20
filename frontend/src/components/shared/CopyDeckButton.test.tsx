// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicDeck } from '../../lib/shared-types';

const copySharedDeckMock = vi.fn((_data: PublicDeck, _token?: string) => 'new-deck-id');
vi.mock('../../lib/copy-shared-deck', () => ({
  copySharedDeck: (data: PublicDeck, token?: string) => copySharedDeckMock(data, token),
}));

const recordDeckCopyMock = vi.fn((_slug: string) => Promise.resolve());
vi.mock('../../lib/share-client', () => ({
  recordDeckCopy: (slug: string) => recordDeckCopyMock(slug),
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
  recordDeckCopyMock.mockClear();
  recordDeckCopyMock.mockReturnValue(Promise.resolve());
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
  it('fires recordDeckCopy once when a slug is present (copying from /d/:slug)', () => {
    renderButton('korvold-treasure');
    fireEvent.click(screen.getByRole('button'));
    expect(recordDeckCopyMock).toHaveBeenCalledTimes(1);
    expect(recordDeckCopyMock).toHaveBeenCalledWith('korvold-treasure');
    expect(copySharedDeckMock).toHaveBeenCalledWith(deck(), 'korvold-treasure');
    expect(navigateMock).toHaveBeenCalledWith('/decks/new-deck-id');
  });

  it('does not fire recordDeckCopy at all when no slug is present (copying from /s/:token)', () => {
    renderButton(undefined);
    fireEvent.click(screen.getByRole('button'));
    expect(recordDeckCopyMock).not.toHaveBeenCalled();
    expect(copySharedDeckMock).toHaveBeenCalledWith(deck(), undefined);
    expect(navigateMock).toHaveBeenCalledWith('/decks/new-deck-id');
  });

  it('still copies, toasts, and navigates even when recordDeckCopy rejects', async () => {
    recordDeckCopyMock.mockReturnValue(Promise.reject(new Error('network down')));
    renderButton('korvold-treasure');
    expect(() => fireEvent.click(screen.getByRole('button'))).not.toThrow();
    expect(copySharedDeckMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith('/decks/new-deck-id');
    // Observe the rejection after assertions so it doesn't leak into another
    // test as an unhandled rejection — the button itself never awaits it.
    await recordDeckCopyMock.mock.results[0]!.value.catch(() => {});
  });
});
