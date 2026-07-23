import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EDHRECCard, ScryfallCard } from '@/deck-builder/types';
import type { RoleKey } from '@/deck-builder/services/tagger/client';

// Deterministic role signals — mirrors phaseRoleSurplusRebalance.test.ts's own
// mock shape. getCardRole drives the pool-candidate filter (keyed by
// whatever name a pool entry uses — front-face-only for a DFC, matching
// EDHREC's own convention); validateCardRole drives computeRoleCounts's
// finalCount via commanderDeckAnalysis.ts's reportRoleOf, which always calls
// it with the card's FULL name (never truncated), even for a DFC — see the
// front-face test below for why both need their own map entry.
const ROLE_OF = new Map<string, RoleKey>();
vi.mock('@/deck-builder/services/tagger/client', () => ({
  getCardRole: vi.fn((name: string) => ROLE_OF.get(name) ?? null),
  validateCardRole: vi.fn((card: { name: string }) => ROLE_OF.get(card.name) ?? null),
  getRampSubtype: vi.fn(() => null),
  getRemovalSubtype: vi.fn(() => null),
  getBoardwipeSubtype: vi.fn(() => null),
  getCardDrawSubtype: vi.fn(() => null),
}));

import { buildRoleDeficitNotes } from './roleDeficitNotes';

function scryfallCard(name: string, overrides: Partial<ScryfallCard> = {}): ScryfallCard {
  return {
    id: name,
    oracle_id: name,
    name,
    cmc: 2,
    type_line: 'Sorcery',
    color_identity: [],
    keywords: [],
    rarity: 'common',
    set: 'tst',
    set_name: 'Test',
    prices: { usd: '1.00' },
    legalities: { commander: 'legal' },
    ...overrides,
  } as ScryfallCard;
}

function edhrecCard(name: string, inclusion: number): EDHRECCard {
  return { name, sanitized: name, primary_type: 'Instant', inclusion, num_decks: 1000 };
}

const ZERO_TARGETS: Record<RoleKey, number> = { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 };

describe('buildRoleDeficitNotes', () => {
  beforeEach(() => {
    ROLE_OF.clear();
  });

  it('returns undefined when roleTargets is null', () => {
    expect(buildRoleDeficitNotes([], null, [])).toBeUndefined();
  });

  it('returns undefined when the pool is empty or missing', () => {
    expect(buildRoleDeficitNotes([], ZERO_TARGETS, [])).toBeUndefined();
    expect(buildRoleDeficitNotes([], ZERO_TARGETS, undefined)).toBeUndefined();
  });

  it('returns undefined when every reactive role already met its target', () => {
    const shipped = [scryfallCard('Removal_1'), scryfallCard('Removal_2')];
    ROLE_OF.set('Removal_1', 'removal');
    ROLE_OF.set('Removal_2', 'removal');
    ROLE_OF.set('Unseated Removal', 'removal');
    const roleTargets = { ...ZERO_TARGETS, removal: 2 };
    const pool = [edhrecCard('Removal_1', 90), edhrecCard('Unseated Removal', 80)];
    expect(buildRoleDeficitNotes(shipped, roleTargets, pool)).toBeUndefined();
  });

  it('discloses a deficit with the top-2 unseated candidates by inclusion', () => {
    const shipped = [scryfallCard('Removal_1')];
    ROLE_OF.set('Removal_1', 'removal');
    ROLE_OF.set(`Assassin's Trophy`, 'removal');
    ROLE_OF.set('Beast Within', 'removal');
    ROLE_OF.set('Third Option', 'removal');
    const roleTargets = { ...ZERO_TARGETS, removal: 8 };
    const pool = [
      edhrecCard('Removal_1', 95),
      edhrecCard(`Assassin's Trophy`, 54),
      edhrecCard('Beast Within', 41),
      edhrecCard('Third Option', 30),
    ];
    const notes = buildRoleDeficitNotes(shipped, roleTargets, pool);

    expect(notes).toHaveLength(1);
    expect(notes![0]).toMatch(/^Removal shipped 1 of its 8-card target/);
    expect(notes![0]).toContain(`Assassin's Trophy (54% of decks)`);
    expect(notes![0]).toContain('Beast Within (41%)');
    expect(notes![0]).not.toContain('Third Option'); // top-2 only, ranked by inclusion desc
    expect(notes![0]).toMatch(/outcompeted at pick time/);
  });

  it('discloses a thin pool with no further options to offer', () => {
    const roleTargets = { ...ZERO_TARGETS, boardwipe: 2 };
    const pool = [edhrecCard('Unrelated Filler', 50)]; // no boardwipe-role entries at all
    const notes = buildRoleDeficitNotes([], roleTargets, pool);

    expect(notes).toHaveLength(1);
    expect(notes![0]).toBe(
      'Board wipe shipped 0 of its 2-card target — the EDHREC pool had no further board wipe to offer.'
    );
  });

  it('excludes banned and salt-blocked candidates from the examples', () => {
    ROLE_OF.set('Banned Removal', 'removal');
    ROLE_OF.set('Salty Removal', 'removal');
    ROLE_OF.set('Legal Removal', 'removal');
    const roleTargets = { ...ZERO_TARGETS, removal: 3 };
    const pool = [
      edhrecCard('Banned Removal', 95),
      edhrecCard('Salty Removal', 90),
      edhrecCard('Legal Removal', 40),
    ];
    const notes = buildRoleDeficitNotes([], roleTargets, pool, {
      bannedCards: new Set(['Banned Removal']),
      isSaltBlocked: (name) => name === 'Salty Removal',
    });

    expect(notes).toHaveLength(1);
    expect(notes![0]).toContain('Legal Removal (40% of decks)');
    expect(notes![0]).not.toContain('Banned Removal');
    expect(notes![0]).not.toContain('Salty Removal');
  });

  it('matches a DFC by front face so an already-shipped card is never re-offered as its own example', () => {
    const dfcName = 'Fable of the Mirror-Breaker // Reflection of Kiki-Jiki';
    const shipped = [scryfallCard(dfcName)];
    // computeRoleCounts's reportRoleOf always calls validateCardRole with the
    // FULL card name (never truncated) — this entry is what makes finalCount
    // register the shipped DFC as removal at all.
    ROLE_OF.set(dfcName, 'removal');
    // The EDHREC pool lists the SAME card by front face only (its own
    // convention for DFCs) — this is the name buildRoleDeficitNotes's own
    // getCardRole(poolEntry.name) filter sees.
    ROLE_OF.set('Fable of the Mirror-Breaker', 'removal');
    ROLE_OF.set('Other Removal', 'removal');
    const roleTargets = { ...ZERO_TARGETS, removal: 2 };
    const pool = [edhrecCard('Fable of the Mirror-Breaker', 95), edhrecCard('Other Removal', 60)];
    const notes = buildRoleDeficitNotes(shipped, roleTargets, pool);

    expect(notes).toHaveLength(1);
    expect(notes![0]).toMatch(/^Removal shipped 1 of its 2-card target/);
    expect(notes![0]).not.toContain('Fable of the Mirror-Breaker (');
    expect(notes![0]).toContain('Other Removal (60% of decks)');
  });

  it('discloses ramp/cardDraw deficits too, even though Phase-3 backfill only wires boardwipe/removal', () => {
    ROLE_OF.set('Ramp Candidate', 'ramp');
    ROLE_OF.set('Draw Candidate', 'cardDraw');
    const roleTargets: Record<RoleKey, number> = { ramp: 1, removal: 0, boardwipe: 0, cardDraw: 1 };
    const pool = [edhrecCard('Ramp Candidate', 50), edhrecCard('Draw Candidate', 50)];
    const notes = buildRoleDeficitNotes([], roleTargets, pool);

    expect(notes).toHaveLength(2);
    expect(notes!.some((n) => n.startsWith('Ramp shipped'))).toBe(true);
    expect(notes!.some((n) => n.startsWith('Card draw shipped'))).toBe(true);
  });
});
