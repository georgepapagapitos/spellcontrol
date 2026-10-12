// @vitest-environment node
//
// Guard (E498): the post-gen fixup and the role-surplus pass read ONE role per
// card, `countedRoleOf` (oracle-validated). Fixup used the raw tagger tag, so
// Blasphemous Edict (tagged boardwipe, but "each player sacrifices thirteen
// creatures" is not a wipe by the evidence rule) opened and filled a wipe gap
// the surplus pass never saw: lathril cut Growing Rites of Itlimoc (27%) for it,
// and the surplus pass swapped the result straight back out. Real tag rows
// and oracle text (Scryfall).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import { loadTaggerData } from '@/deck-builder/services/tagger/client';
import { countedRoleOf } from '../commanderDeckAnalysis';
import { postGenFixupPhase } from './phasePostGenFixup';
import type { GenerationState } from './state';

const EDICT = 'Blasphemous Edict';
const KINDRED = 'Kindred Dominance';
const RITES = 'Growing Rites of Itlimoc';

beforeAll(async () => {
  vi.stubGlobal('fetch', async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      generatedAt: 'pinned',
      tags: { boardwipe: [EDICT, KINDRED], removal: [EDICT, KINDRED] },
    }),
  }));
  if (!(await loadTaggerData())) throw new Error('tagger data failed to load');
});
afterAll(() => vi.unstubAllGlobals());

const card = (name: string, oracle_text: string, extra: Partial<ScryfallCard> = {}) =>
  ({
    id: name,
    oracle_id: name,
    name,
    oracle_text,
    cmc: 5,
    type_line: 'Sorcery',
    color_identity: [],
    keywords: [],
    prices: {},
    legalities: { commander: 'legal' },
    ...extra,
  }) as unknown as ScryfallCard;

const edict = card(
  EDICT,
  "You may pay {B} rather than pay this spell's mana cost if there are thirteen or more creatures on the battlefield.\nEach player sacrifices thirteen creatures."
);
const kindred = card(
  KINDRED,
  "Choose a creature type. Destroy all creatures that aren't of the chosen type."
);
const rites = card(RITES, 'Whenever you play a creature, you may reveal it.', {
  type_line: 'Enchantment',
  cmc: 3,
});

describe('fixup and surplus read the same role', () => {
  it('counts Kindred Dominance as the wipe and Blasphemous Edict as not one', () => {
    expect(countedRoleOf(kindred)).toBe('boardwipe');
    expect(countedRoleOf(edict)).not.toBe('boardwipe');
  });

  it('fills a wipe gap with the counted wipe, never the tagged-only one', () => {
    const state = {
      context: {
        commander: card('Commander', ''),
        colorIdentity: [],
        customization: {
          balancedRoles: true,
          mustIncludeCards: [],
          tempMustIncludeCards: [],
          tinyLeaders: false,
        },
      },
      cfg: { collectionStrategy: 'full', maxCardPrice: null, format: 99 },
      usedNames: new Set([RITES]),
      bannedCards: new Set<string>(),
      categories: {
        lands: [],
        ramp: [],
        cardDraw: [],
        singleRemoval: [],
        boardWipes: [],
        creatures: [],
        synergy: [rites],
        utility: [],
      },
      currentRoleCounts: { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 },
      comboCardNames: new Set<string>(),
      edhrecData: {
        cardlists: {
          allNonLand: [
            { name: EDICT, inclusion: 70 },
            { name: KINDRED, inclusion: 40 },
          ],
        },
      },
    } as unknown as GenerationState;
    postGenFixupPhase(state, {
      roleTargets: { ramp: 0, removal: 0, boardwipe: 2, cardDraw: 0 },
      swapCandidates: undefined,
      scryfallCardMap: new Map([
        [EDICT, edict],
        [KINDRED, kindred],
      ]),
      repairAddedNames: new Set(),
    });
    expect(state.usedNames.has(KINDRED)).toBe(true);
    expect(state.usedNames.has(EDICT)).toBe(false);
    expect(state.currentRoleCounts.boardwipe).toBe(1);
  });
});
