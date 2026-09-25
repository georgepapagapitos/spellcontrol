// @vitest-environment happy-dom
/**
 * A partner the list itself put under its Commander header ("Commander /
 * 1 Pako / 1 Haldan", the way Moxfield and most exports write it) used to be
 * dropped by the server, so the import lost it. It now arrives already picked
 * in review, and the deck is built with it in the command zone. A partner
 * found only among the cards is still offered, never auto-paired.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../../store/auth';
import type { PublishResult } from '../../lib/publications-client';
import type { DeckImportResponse } from '../../types';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const real = await importOriginal<typeof import('react-router-dom')>();
  return { ...real, useNavigate: () => navigateMock };
});

vi.mock('../../store/decks', () => ({
  useDecksStore: (sel: (s: { decks: unknown[] }) => unknown) => sel({ decks: [] }),
}));

const buildDeckFromResultMock = vi.fn((..._args: unknown[]) => 'new-deck-id');
vi.mock('../../lib/build-deck-from-import', () => ({
  useBuildDeckFromImport: () => buildDeckFromResultMock,
}));

const importDeckTextMock = vi.fn<() => Promise<DeckImportResponse>>();
vi.mock('../../lib/api', () => ({
  importDeckText: () => importDeckTextMock(),
  importDeckFile: vi.fn(),
}));

vi.mock('../../lib/sync', () => ({
  isOnline: () => true,
  onSyncedChange: () => () => {},
}));

const updateProfileMock = vi.fn();
vi.mock('../../lib/auth-api', () => ({
  updateProfile: (patch: { displayName: string }) => updateProfileMock(patch),
}));

const publishDeckMock = vi.fn<() => Promise<PublishResult>>();
vi.mock('../../lib/publications-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/publications-client')>();
  return {
    ...actual,
    publishDeck: () => publishDeckMock(),
    publicationUrl: (slug: string) => `https://spellcontrol.com/d/${slug}`,
  };
});

// The commander search is never opened here: the list names its commander.
vi.mock('./CommanderSearch', () => ({ CommanderSearch: () => null }));

import { ImportDeckDialog } from './ImportDeckDialog';

// Real oracle text (Scryfall, 2026-09-24): the pairing rule reads it.
const card = (name: string, oracle: string, keywords: string[]) =>
  ({ id: name, name, type_line: 'Legendary Creature', keywords, oracle_text: oracle }) as never;
const PAKO = card(
  'Pako, Arcane Retriever',
  "Partner with Haldan, Avid Arcanist\nHaste\nWhenever Pako attacks, exile the top card of each player's library and put a fetch counter on each of them. Put a +1/+1 counter on Pako for each noncreature card exiled this way.",
  ['Partner with', 'Haste', 'Partner']
);
const HALDAN = card(
  'Haldan, Avid Arcanist',
  'Partner with Pako, Arcane Retriever (When this creature enters, target player may put Pako into their hand from their library, then shuffle.)\nYou may play lands and cast noncreature spells from among cards you exiled that have fetch counters on them, and you may spend mana as though it were mana of any color to cast those spells.',
  ['Partner with', 'Partner']
);

function base(over: Partial<DeckImportResponse>): DeckImportResponse {
  return {
    commander: PAKO,
    companion: null,
    cards: [HALDAN],
    unresolvedNames: [],
    fetchErrors: [],
    detectedFormat: 'commander',
    cardCount: 2,
    ...over,
  };
}

function pasteAndImport() {
  render(
    <MemoryRouter>
      <ImportDeckDialog onClose={vi.fn()} />
    </MemoryRouter>
  );
  fireEvent.change(screen.getByPlaceholderText(/Commander/), {
    target: { value: 'Commander\n1 Pako, Arcane Retriever\n1 Haldan, Avid Arcanist' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Import' }));
}

beforeEach(() => {
  useAuth.setState({ user: null, status: 'guest', error: null, autoLinkedAt: null, profile: null });
  buildDeckFromResultMock.mockClear().mockReturnValue('new-deck-id');
});
afterEach(() => localStorage.clear());

describe('ImportDeckDialog — a partner the list named', () => {
  it('arrives already picked, and the deck is built with it', async () => {
    importDeckTextMock.mockReset().mockResolvedValue(base({ partner: HALDAN }));
    pasteAndImport();
    const option = await screen.findByRole('button', { name: /Haldan, Avid Arcanist/ });
    expect(option.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Create deck' }));
    await waitFor(() => expect(buildDeckFromResultMock).toHaveBeenCalled());
    const [, commander, , , opts] = buildDeckFromResultMock.mock.calls[0] as unknown[];
    expect((commander as { name: string }).name).toBe('Pako, Arcane Retriever');
    expect((opts as { partner: { name: string } | null }).partner?.name).toBe(
      'Haldan, Avid Arcanist'
    );
  });

  it('only offers a partner the list did not name', async () => {
    importDeckTextMock.mockReset().mockResolvedValue(base({ partner: null }));
    pasteAndImport();
    const option = await screen.findByRole('button', { name: /Haldan, Avid Arcanist/ });
    expect(option.getAttribute('aria-pressed')).toBe('false');
  });
});
