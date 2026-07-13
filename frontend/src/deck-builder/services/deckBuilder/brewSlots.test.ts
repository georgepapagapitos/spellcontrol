import { describe, it, expect, vi } from 'vitest';
import type { EDHRECCard } from '@/deck-builder/types';

// pickBrewCandidates/computeBrewRoleTargets classify cards via the tagger
// client, which normally reads a fetched tagger-tags.json. Unit tests don't
// load that fixture, so stub a small, explicit name -> role map instead.
const ROLE_FIXTURE: Record<string, 'ramp' | 'removal' | 'boardwipe' | 'cardDraw'> = {
  'Sol Ring': 'ramp',
  'Arcane Signet': 'ramp',
  'Owned Rock': 'ramp',
};
vi.mock('@/deck-builder/services/tagger/client', () => ({
  getCardRole: (name: string) => ROLE_FIXTURE[name] ?? null,
}));

const {
  bucketForSlot,
  buildBrewSlotPlan,
  computeBrewRoleTargets,
  flattenAccepted,
  pickBrewCandidates,
  tallyRoleCounts,
} = await import('./brewSlots');
type BrewCandidate = ReturnType<typeof pickBrewCandidates>[number];

function card(overrides: Partial<EDHRECCard> & { name: string; inclusion: number }): EDHRECCard {
  return {
    sanitized: overrides.name.toLowerCase(),
    primary_type: 'Artifact',
    num_decks: 1000,
    ...overrides,
  };
}

describe('bucketForSlot', () => {
  it('routes a tagger-classified card to its functional role regardless of other flags', () => {
    const sol = card({ name: 'Sol Ring', inclusion: 99, isGameChanger: true });
    expect(bucketForSlot(sol, 'ramp')).toBe('ramp');
  });

  it('routes an untagged Game Changer to finishers', () => {
    const c = card({ name: 'Some Bomb', inclusion: 40, isGameChanger: true });
    expect(bucketForSlot(c, null)).toBe('finishers');
  });

  it('routes an untagged theme-synergy card to theme', () => {
    const c = card({ name: 'Synergy Card', inclusion: 20, isThemeSynergyCard: true });
    expect(bucketForSlot(c, null)).toBe('theme');
  });

  it('routes a plain untagged card to flex', () => {
    const c = card({ name: 'Filler', inclusion: 15 });
    expect(bucketForSlot(c, null)).toBe('flex');
  });
});

describe('pickBrewCandidates', () => {
  const pool: EDHRECCard[] = [
    card({ name: 'Sol Ring', inclusion: 99 }), // role: ramp (mocked below)
    card({ name: 'Arcane Signet', inclusion: 90 }), // role: ramp
    card({ name: 'Basic Island', inclusion: 100 }), // basic land — always excluded
    card({ name: 'Owned Rock', inclusion: 30 }), // role: ramp, owned
  ];

  it('excludes basics and already-excluded names, ranks by priority + owned boost', () => {
    const results = pickBrewCandidates(
      pool,
      'ramp',
      new Set(['Sol Ring']),
      new Set(['Owned Rock']),
      6
    );
    const names = results.map((r) => r.name);
    expect(names).not.toContain('Sol Ring');
    expect(names).not.toContain('Basic Island');
    // Owned Rock has much lower inclusion but the ownership boost (40) should
    // still not vault it over a genuinely higher-inclusion unowned card —
    // just confirm it's present and marked owned.
    const owned = results.find((r) => r.name === 'Owned Rock');
    expect(owned?.isOwned).toBe(true);
  });

  it('boosts only names present in the passed-in ownership set — free-copy-aware by construction', () => {
    // pickBrewCandidates never re-derives ownership itself; it trusts
    // whatever set the caller passes. The brew page passes free-copy names
    // (buildAvailableCollection(...).names), so a card that's nominally
    // owned but has every copy claimed by another deck is simply absent from
    // that set here — same as if it were unowned — and a genuinely free
    // card with slightly lower raw inclusion now outranks it.
    const claimedElsewhere = card({ name: 'Claimed Rock', inclusion: 50 });
    const genuinelyFree = card({ name: 'Free Rock', inclusion: 48 });
    const results = pickBrewCandidates(
      [claimedElsewhere, genuinelyFree],
      'flex',
      new Set(),
      new Set(['Free Rock']), // "Claimed Rock" deliberately absent
      2
    );
    expect(results[0].name).toBe('Free Rock');
    expect(results[0].isOwned).toBe(true);
    expect(results[1].name).toBe('Claimed Rock');
    expect(results[1].isOwned).toBe(false);
  });

  it('respects the requested hand size', () => {
    // Untagged, non-game-changer, non-synergy cards fall into 'flex'.
    const bigPool = Array.from({ length: 20 }, (_, i) => card({ name: `Rock ${i}`, inclusion: i }));
    const results = pickBrewCandidates(bigPool, 'flex', new Set(), undefined, 6);
    expect(results.length).toBe(6);
    // Highest inclusion first.
    expect(results[0].name).toBe('Rock 19');
  });
});

describe('computeBrewRoleTargets', () => {
  it('returns positive targets for a 99-card deck even with no EDHREC role data', () => {
    const edhrecData = { cardlists: { allNonLand: [] } } as never;
    const targets = computeBrewRoleTargets(edhrecData, 99);
    expect(targets.ramp).toBeGreaterThan(0);
    expect(targets.removal).toBeGreaterThan(0);
    expect(targets.boardwipe).toBeGreaterThanOrEqual(0);
    expect(targets.cardDraw).toBeGreaterThan(0);
  });
});

describe('buildBrewSlotPlan', () => {
  it('orders slots ramp -> cardDraw -> removal -> boardwipe -> theme -> finishers -> flex', () => {
    const slots = buildBrewSlotPlan({
      roleTargets: { ramp: 10, cardDraw: 10, removal: 8, boardwipe: 3 },
      nonlandTotal: 62,
      hasTheme: true,
      themeLabel: 'Counters',
    });
    expect(slots.map((s) => s.key)).toEqual([
      'ramp',
      'cardDraw',
      'removal',
      'boardwipe',
      'theme',
      'finishers',
      'flex',
    ]);
  });

  it('omits the theme slot when no theme is selected, and every target is non-negative', () => {
    const slots = buildBrewSlotPlan({
      roleTargets: { ramp: 10, cardDraw: 10, removal: 8, boardwipe: 3 },
      nonlandTotal: 62,
      hasTheme: false,
    });
    expect(slots.find((s) => s.key === 'theme')).toBeUndefined();
    for (const slot of slots) expect(slot.target).toBeGreaterThanOrEqual(0);
  });
});

describe('tallyRoleCounts / flattenAccepted', () => {
  const c = (name: string, role?: 'ramp' | 'removal'): BrewCandidate => ({
    name,
    price: null,
    inclusion: 10,
    synergy: 0,
    typeLine: 'Artifact',
    isOwned: false,
    role,
    roleLabel: role,
  });

  it('tallies accepted cards by role', () => {
    const counts = tallyRoleCounts([c('A', 'ramp'), c('B', 'ramp'), c('C', 'removal'), c('D')]);
    expect(counts.ramp).toBe(2);
    expect(counts.removal).toBe(1);
    expect(counts.cardDraw).toBe(0);
  });

  it('flattens accepted cards across slots in slot order', () => {
    const slots = buildBrewSlotPlan({
      roleTargets: { ramp: 1, cardDraw: 1, removal: 1, boardwipe: 0 },
      nonlandTotal: 10,
      hasTheme: false,
    });
    const accepted = { ramp: [c('R1')], removal: [c('X1')], flex: [c('F1')] };
    const flat = flattenAccepted(accepted, slots);
    expect(flat.map((x) => x.name)).toEqual(['R1', 'X1', 'F1']);
  });
});
