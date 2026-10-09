import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { moveViolations, type ApplyEnv, type DeckSettings } from './applyCoachMoves';

// Sol Ring's real legalities: legal in Commander, banned in Brawl, not
// legal in Pauper Commander.
const SOL_RING = {
  name: 'Sol Ring',
  color_identity: [],
  legalities: { commander: 'legal', brawl: 'banned', paupercommander: 'not_legal' },
} as unknown as ScryfallCard;

const settings = (mtgFormat?: string): DeckSettings => ({
  colorIdentity: ['G'],
  mtgFormat,
  deckBudget: null,
  maxCardPrice: null,
  targetBracket: null,
  gameChangerLimit: 'unlimited',
  maxRarity: null,
  collectionMode: false,
  collectionStrategy: 'full',
  collectionOwnedPercent: 75,
  ignoreOwnedBudget: false,
  ignoreOwnedRarity: false,
  ownedNames: new Set(),
});

const env = { isGameChanger: () => false, bracketOf: () => null } as unknown as ApplyEnv;

describe('moveViolations format legality', () => {
  const run = (mtgFormat?: string) =>
    moveViolations(settings(mtgFormat), env, [], [SOL_RING], SOL_RING);

  it('rejects a card banned in the deck format (Brawl)', () => {
    expect(run('brawl')).toContain('not-legal');
  });
  it('rejects a card not legal in Pauper Commander', () => {
    expect(run('paupercommander')).toContain('not-legal');
  });
  it('accepts it for Commander, and when no format is known', () => {
    expect(run('commander')).not.toContain('not-legal');
    expect(run(undefined)).not.toContain('not-legal');
  });
});
