import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import fixture from './__fixtures__/owned-resolution.fixture.json';

vi.mock('@/deck-builder/services/scryfall/client', () => ({
  getCardsByIds: vi.fn(async () => new Map()),
  getCardsByNames: vi.fn(async () => new Map()),
}));

import { getCardsByIds, getCardsByNames } from '@/deck-builder/services/scryfall/client';
import { isSameCard, resolveOwnedCards } from './ownedCardResolution';

// Real Scryfall cards (owned-resolution.fixture.json).
const REAL = new Map(fixture.cards.map((c) => [c.name, c as unknown as ScryfallCard]));
const real = (name: string) => REAL.get(name)!;
const BRAINSTORM = real('Brainstorm');
const IMPOSTOR = real('Harmonized Trio // Brainstorm');
const FABLE = real('Fable of the Mirror-Breaker // Reflection of Kiki-Jiki');

beforeEach(() => {
  vi.mocked(getCardsByIds).mockReset().mockResolvedValue(new Map());
  vi.mocked(getCardsByNames).mockReset().mockResolvedValue(new Map());
});

describe('isSameCard', () => {
  it('accepts the card or its front face, never a back face (#2157)', () => {
    expect(isSameCard('Brainstorm', BRAINSTORM)).toBe(true);
    expect(isSameCard('Brainstorm', IMPOSTOR)).toBe(false);
    expect(isSameCard('Harmonized Trio', IMPOSTOR)).toBe(true);
    expect(isSameCard('Fable of the Mirror-Breaker', FABLE)).toBe(true);
  });
});

describe('resolveOwnedCards', () => {
  it('drops a name lookup that answered with a different card', async () => {
    vi.mocked(getCardsByNames).mockResolvedValue(new Map([['Brainstorm', IMPOSTOR]]));
    const out = await resolveOwnedCards([{ name: 'Brainstorm', colorIdentity: ['U'] }], {
      arenaOnly: false,
    });
    expect(out.byName.size).toBe(0);
  });

  it('resolves by printing id, then fetches the playable card by its canonical name', async () => {
    vi.mocked(getCardsByIds).mockResolvedValue(new Map([['print-1', BRAINSTORM]]));
    vi.mocked(getCardsByNames).mockResolvedValue(new Map([['Brainstorm', BRAINSTORM]]));
    // A row spelled some other way (another language) still resolves by its id.
    const out = await resolveOwnedCards(
      [{ name: 'Lluvia de ideas', colorIdentity: ['U'], scryfallId: 'print-1' }],
      { arenaOnly: false, ownedNames: new Set(['Lluvia de ideas']) }
    );
    expect(vi.mocked(getCardsByNames).mock.calls[0][0]).toEqual(['Brainstorm']);
    expect(out.byName.get('Lluvia de ideas')).toBe(BRAINSTORM);
    // The canonical name joins the owned names, so ownership checks see it.
    expect(out.aliases).toEqual(['Brainstorm']);
  });

  it('drops a card whose oracle id is not the printing it was resolved from', async () => {
    vi.mocked(getCardsByIds).mockResolvedValue(new Map([['print-1', BRAINSTORM]]));
    vi.mocked(getCardsByNames).mockResolvedValue(
      new Map([['Brainstorm', { ...BRAINSTORM, oracle_id: 'someone-else' }]])
    );
    const out = await resolveOwnedCards(
      [{ name: 'Brainstorm', colorIdentity: ['U'], scryfallId: 'print-1' }],
      { arenaOnly: false }
    );
    expect(out.byName.size).toBe(0);
  });

  it('keeps a front-face row, and names the full card as owned', async () => {
    vi.mocked(getCardsByNames).mockResolvedValue(new Map([['Fable of the Mirror-Breaker', FABLE]]));
    const out = await resolveOwnedCards(
      [{ name: 'Fable of the Mirror-Breaker', colorIdentity: ['R'] }],
      { arenaOnly: false, ownedNames: new Set(['Fable of the Mirror-Breaker']) }
    );
    expect(out.byName.get('Fable of the Mirror-Breaker')).toBe(FABLE);
    expect(out.aliases).toEqual([FABLE.name]);
  });
});
