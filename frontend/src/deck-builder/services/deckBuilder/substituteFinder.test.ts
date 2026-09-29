import { describe, expect, it, vi } from 'vitest';
import type { GapAnalysisCard } from '@/deck-builder/types';

// Tagger data isn't loaded in the test env, so the real role/subtype lookups
// would always return empty. Mock them with a small fixture taxonomy. Roles are
// listed per card so `cardMatchesRole` can match a non-primary role too.
vi.mock('@/deck-builder/services/tagger/client', () => {
  const roles: Record<string, string[]> = {
    'Mind Stone': ['ramp'],
    'Worn Powerstone': ['ramp'],
    'Llanowar Elves': ['ramp'],
    Cultivate: ['ramp'],
    'Off-Color Signet': ['ramp'],
    'Swords to Plowshares': ['removal'],
    'Wrath of God': ['boardwipe'],
    'Mystic Confluence': ['cardDraw', 'removal'], // multi-role; primary is cardDraw
    // E460/E476: the generic ramp tag on cards whose job is something else.
    // The real `cardMatchesRole` gives them no ramp role (pinned against real
    // tags in substituteFinder.incidental.test.ts); the mock says the same.
    'Mana Drain': [],
    'Sword of Feast and Famine': [],
    'Rampant Growth': ['ramp'],
  };
  const subtypes: Record<string, string | null> = {
    // wanted (missing) staples — only their subtype is consulted
    'Talisman of Dominance': 'mana-rock',
    'Dimir Signet': 'mana-rock',
    'Beast Within': 'spot-removal',
    // owned candidates
    'Mind Stone': 'mana-rock',
    'Worn Powerstone': 'mana-rock',
    'Llanowar Elves': 'mana-producer',
    Cultivate: 'ramp',
    'Mana Drain': 'ramp',
    'Sword of Feast and Famine': 'ramp',
    'Rampant Growth': 'ramp',
  };
  // Functional fingerprints for the similarity Jaccard. Cards omitted here fall
  // back to their role list (so existing fixtures keep a sensible overlap).
  const tags: Record<string, string[]> = {
    'Talisman of Dominance': ['mana-rock', 'ramp'],
    'Dimir Signet': ['mana-rock', 'ramp'],
    'Mind Stone': ['mana-rock', 'ramp'],
    'Worn Powerstone': ['mana-rock', 'ramp'],
    'Llanowar Elves': ['mana-dork', 'ramp'],
    Cultivate: ['ramp', 'mana-fix'],
    'Mana Drain': ['ramp', 'counterspell'],
    'Sword of Feast and Famine': ['ramp', 'protection'],
    'Rampant Growth': ['ramp', 'land-tutor'],
  };
  return {
    cardMatchesRole: (name: string, role: string) => (roles[name] ?? []).includes(role),
    getCardSubtype: (name: string) => subtypes[name] ?? null,
    getCardTags: (name: string) => tags[name] ?? roles[name] ?? [],
  };
});

import {
  findOwnedSubstitute,
  buildSubstitutionPlan,
  buildSubstitutionOptions,
  type OptionsReranker,
  type SubstituteCandidate,
} from './substituteFinder';

// ── Fixtures ────────────────────────────────────────────────────────────

function owned(over: Partial<SubstituteCandidate> & { name: string }): SubstituteCandidate {
  return { colorIdentity: [], cmc: 2, ...over };
}

function missing(over: Partial<GapAnalysisCard> & { name: string }): GapAnalysisCard {
  return {
    price: null,
    inclusion: 50,
    synergy: 0,
    typeLine: 'Artifact',
    isOwned: false,
    ...over,
  };
}

const DIMIR = ['U', 'B'];

// ── findOwnedSubstitute ───────────────────────────────────────────────────

describe('findOwnedSubstitute', () => {
  it('returns the owned same-role card with a verdict reason', () => {
    const row = findOwnedSubstitute(
      missing({ name: 'Talisman of Dominance', role: 'ramp', roleLabel: 'Ramp', cmc: 2 }),
      [owned({ name: 'Mind Stone', cmc: 2 })],
      new Set(),
      DIMIR
    );
    expect(row).not.toBeNull();
    expect(row).toMatchObject({
      wantedName: 'Talisman of Dominance',
      wantedRole: 'ramp',
      usedName: 'Mind Stone',
      usedSubtypeMatch: true,
    });
    expect(row!.reason).toBe('Mind Stone fills the 2-mana Ramp slot. Owned, same mana rock.');
  });

  it('never seats a card that only makes mana on the side in a ramp slot (E460)', () => {
    const row = findOwnedSubstitute(
      missing({ name: 'Farseek', role: 'ramp', roleLabel: 'Ramp', cmc: 2, typeLine: 'Sorcery' }),
      [
        owned({ name: 'Mana Drain', cmc: 2, typeLine: 'Instant' }),
        owned({ name: 'Sword of Feast and Famine', cmc: 3, typeLine: 'Artifact — Equipment' }),
      ],
      new Set(),
      ['G', 'U']
    );
    expect(row).toBeNull();
  });

  it('keeps real ramp, and never calls the generic ramp tag "same ramp"', () => {
    const row = findOwnedSubstitute(
      missing({ name: 'Farseek', role: 'ramp', roleLabel: 'Ramp', cmc: 2, typeLine: 'Sorcery' }),
      [
        owned({ name: 'Mana Drain', cmc: 2, typeLine: 'Instant' }),
        owned({ name: 'Rampant Growth', cmc: 2, typeLine: 'Sorcery' }),
      ],
      new Set(),
      ['G', 'U']
    );
    expect(row?.usedName).toBe('Rampant Growth');
    expect(row!.reason).toBe('Rampant Growth fills the 2-mana Ramp slot. Owned, same role.');
    expect(row!.whyFactors?.map((f) => f.text).join(' ')).not.toMatch(/Same ramp/);
  });

  it('returns null when nothing owned fills the role (a genuine buy)', () => {
    const row = findOwnedSubstitute(
      missing({ name: 'Talisman of Dominance', role: 'ramp', cmc: 2 }),
      [owned({ name: 'Swords to Plowshares' })], // removal only
      new Set(),
      DIMIR
    );
    expect(row).toBeNull();
  });

  it('prefers a same-subtype substitute over a closer-CMC one', () => {
    const row = findOwnedSubstitute(
      missing({ name: 'Talisman of Dominance', role: 'ramp', cmc: 2 }),
      [
        owned({ name: 'Llanowar Elves', cmc: 2 }), // mana-producer, exact CMC, NO subtype match
        owned({ name: 'Worn Powerstone', cmc: 3 }), // mana-rock, worse CMC, subtype match
      ],
      new Set(),
      DIMIR
    );
    expect(row!.usedName).toBe('Worn Powerstone');
    expect(row!.usedSubtypeMatch).toBe(true);
  });

  it('prefers the higher tag-overlap substitute when subtype and CMC tie', () => {
    // Both are owned ramp pieces at the same CMC; Mind Stone shares the wanted
    // card's full tag fingerprint (mana-rock+ramp) while Llanowar Elves only
    // shares 'ramp' — similarity should pick the closer functional match.
    const row = findOwnedSubstitute(
      missing({ name: 'Talisman of Dominance', role: 'ramp', cmc: 2 }),
      [
        owned({ name: 'Llanowar Elves', cmc: 2 }), // shares only 'ramp'
        owned({ name: 'Mind Stone', cmc: 2 }), // shares mana-rock + ramp
      ],
      new Set(),
      DIMIR
    );
    expect(row!.usedName).toBe('Mind Stone');
  });

  it('excludes owned cards outside the deck color identity', () => {
    const row = findOwnedSubstitute(
      missing({ name: 'Talisman of Dominance', role: 'ramp', cmc: 2 }),
      [owned({ name: 'Off-Color Signet', colorIdentity: ['R'] })],
      new Set(),
      DIMIR
    );
    expect(row).toBeNull();
  });

  it('never substitutes a land for a spell (E282)', () => {
    const row = findOwnedSubstitute(
      missing({ name: 'Talisman of Dominance', role: 'ramp', cmc: 2, typeLine: 'Artifact' }),
      [owned({ name: 'Mind Stone', cmc: 2, typeLine: 'Land' })],
      new Set(),
      DIMIR
    );
    expect(row).toBeNull();
  });

  it('excludes owned cards already in the deck', () => {
    const row = findOwnedSubstitute(
      missing({ name: 'Talisman of Dominance', role: 'ramp', cmc: 2 }),
      [owned({ name: 'Mind Stone', cmc: 2 })],
      new Set(['Mind Stone']),
      DIMIR
    );
    expect(row).toBeNull();
  });

  it('matches a non-primary role of a multi-role card', () => {
    // Mystic Confluence's primary role is cardDraw, but it also matches removal.
    const row = findOwnedSubstitute(
      missing({ name: 'Beast Within', role: 'removal', roleLabel: 'Removal', cmc: 3 }),
      [owned({ name: 'Mystic Confluence', cmc: 5 })],
      new Set(),
      DIMIR
    );
    expect(row!.usedName).toBe('Mystic Confluence');
    expect(row!.usedSubtypeMatch).toBe(false);
    expect(row!.reason).toBe('Mystic Confluence fills the 3-mana Removal slot. Owned, same role.');
  });

  it('returns null for a missing card with no functional role', () => {
    const row = findOwnedSubstitute(
      missing({ name: 'Some Vanilla Card' }), // no role
      [owned({ name: 'Mind Stone' })],
      new Set(),
      DIMIR
    );
    expect(row).toBeNull();
  });

  it('breaks ties on EDHREC inclusion when subtype and CMC are equal', () => {
    const row = findOwnedSubstitute(
      missing({ name: 'Dimir Signet', role: 'ramp', cmc: 2 }),
      [owned({ name: 'Mind Stone', cmc: 2 }), owned({ name: 'Worn Powerstone', cmc: 2 })],
      new Set(),
      DIMIR,
      {
        inclusionByName: new Map([
          ['Mind Stone', 30],
          ['Worn Powerstone', 70],
        ]),
      }
    );
    expect(row!.usedName).toBe('Worn Powerstone');
  });

  it('omits the mana prefix from the reason when the wanted CMC is unknown', () => {
    const row = findOwnedSubstitute(
      missing({ name: 'Talisman of Dominance', role: 'ramp', roleLabel: 'Ramp' }), // no cmc
      [owned({ name: 'Mind Stone', cmc: 2 })],
      new Set(),
      DIMIR
    );
    expect(row!.reason).toBe('Mind Stone fills the Ramp slot. Owned, same mana rock.');
  });
});

// ── buildSubstitutionPlan ──────────────────────────────────────────────────

describe('buildSubstitutionPlan', () => {
  it('assigns each owned card to at most one staple', () => {
    const plan = buildSubstitutionPlan(
      [
        missing({ name: 'Talisman of Dominance', role: 'ramp', cmc: 2 }),
        missing({ name: 'Dimir Signet', role: 'ramp', cmc: 2 }),
      ],
      [owned({ name: 'Mind Stone', cmc: 2 }), owned({ name: 'Worn Powerstone', cmc: 2 })],
      new Set(),
      DIMIR
    );
    expect(plan.rows).toHaveLength(2);
    const used = plan.rows.map((r) => r.usedName).sort();
    expect(used).toEqual(['Mind Stone', 'Worn Powerstone']);
    expect(plan.unmatched).toEqual([]);
  });

  it('lists staples with no remaining substitute as unmatched', () => {
    const plan = buildSubstitutionPlan(
      [
        missing({ name: 'Talisman of Dominance', role: 'ramp', cmc: 2 }),
        missing({ name: 'Dimir Signet', role: 'ramp', cmc: 2 }),
      ],
      [owned({ name: 'Mind Stone', cmc: 2 })], // only one owned ramp piece
      new Set(),
      DIMIR
    );
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].usedName).toBe('Mind Stone');
    expect(plan.unmatched).toEqual(['Dimir Signet']);
  });
});

describe('buildSubstitutionOptions', () => {
  it('returns the best owned pick as primary plus ranked alternatives with why factors', () => {
    const plan = buildSubstitutionOptions(
      [missing({ name: 'Talisman of Dominance', role: 'ramp', cmc: 2 })],
      [
        owned({ name: 'Mind Stone', colorIdentity: [], cmc: 2 }),
        owned({ name: 'Worn Powerstone', colorIdentity: [], cmc: 3 }),
        owned({ name: 'Llanowar Elves', colorIdentity: ['G'], cmc: 1 }),
      ],
      new Set<string>(),
      DIMIR
    );
    expect(plan.rows).toHaveLength(1);
    const primary = plan.rows[0];
    // Mana-rock subtype + closer CMC ranks the rocks above the dork.
    expect(primary.usedName).toBe('Mind Stone');
    expect(primary.alternatives?.map((a) => a.usedName)).toEqual(['Worn Powerstone']);
    // Llanowar Elves is out of the Dimir identity, so it never appears.
    expect(primary.whyFactors && primary.whyFactors.length).toBeGreaterThan(0);
    expect(primary.alternatives?.[0].whyFactors?.length).toBeGreaterThan(0);
  });

  it('never offers a card that is already another staple primary as an alternative', () => {
    // Two ramp staples, two owned rocks: each becomes one staple's primary, so
    // neither can also be the other staple's alternative (no double-allocation).
    const plan = buildSubstitutionOptions(
      [
        missing({ name: 'Talisman of Dominance', role: 'ramp', cmc: 2 }),
        missing({ name: 'Dimir Signet', role: 'ramp', cmc: 2 }),
      ],
      [
        owned({ name: 'Mind Stone', colorIdentity: [], cmc: 2 }),
        owned({ name: 'Worn Powerstone', colorIdentity: [], cmc: 3 }),
      ],
      new Set<string>(),
      DIMIR
    );
    const used = plan.rows.map((r) => r.usedName);
    expect(new Set(used).size).toBe(used.length); // distinct primaries
    for (const row of plan.rows) {
      for (const alt of row.alternatives ?? []) {
        expect(used).not.toContain(alt.usedName);
      }
    }
  });

  // E517: v2 re-ranks the Coach lane's candidates; it never changes which cards qualify.
  describe('with a v2 re-ranker', () => {
    const pool = [
      owned({ name: 'Mind Stone', colorIdentity: [], cmc: 2 }),
      owned({ name: 'Worn Powerstone', colorIdentity: [], cmc: 3 }),
      owned({ name: 'Rampant Growth', colorIdentity: [], cmc: 2, typeLine: 'Sorcery' }),
    ];
    const staple = missing({ name: 'Talisman of Dominance', role: 'ramp', cmc: 2 });
    const names = (p: ReturnType<typeof buildSubstitutionOptions>) => [
      p.rows[0].usedName,
      ...(p.rows[0].alternatives ?? []).map((a) => a.usedName),
    ];
    const reversed: OptionsReranker = {
      rank: (_missing, candidates) => ({
        order: [...candidates].reverse(),
        factorsFor: (name, v1) => [{ text: `v2 for ${name}`, tone: 'pro' }, ...(v1 ?? [])],
      }),
    };

    it('takes its order and merges its reasons, over the same candidates', () => {
      const v1 = buildSubstitutionOptions([staple], pool, new Set<string>(), DIMIR);
      const v2 = buildSubstitutionOptions([staple], pool, new Set<string>(), DIMIR, {
        rerank: reversed,
      });
      expect(names(v2)).toEqual([...names(v1)].reverse());
      expect(v2.rows[0].whyFactors?.[0].text).toBe(`v2 for ${v2.rows[0].usedName}`);
      // The finder's own factors survive under v2's.
      expect(v2.rows[0].whyFactors?.length).toBeGreaterThan(1);
    });

    it('keeps the finder order when the re-ranker declines', () => {
      const declines: OptionsReranker = { rank: () => null };
      expect(
        buildSubstitutionOptions([staple], pool, new Set<string>(), DIMIR, { rerank: declines })
      ).toEqual(buildSubstitutionOptions([staple], pool, new Set<string>(), DIMIR));
    });

    it('never offers one staple the card claimed as another staple primary', () => {
      const plan = buildSubstitutionOptions(
        [staple, missing({ name: 'Dimir Signet', role: 'ramp', cmc: 2 })],
        pool,
        new Set<string>(),
        DIMIR,
        { rerank: reversed }
      );
      const used = plan.rows.map((r) => r.usedName);
      expect(new Set(used).size).toBe(used.length);
      for (const row of plan.rows)
        for (const alt of row.alternatives ?? []) expect(used).not.toContain(alt.usedName);
    });

    it('keeps a candidate the re-ranker leaves out, after the ones it ordered', () => {
      const lastOnly: OptionsReranker = {
        rank: (_missing, candidates) => ({
          order: [candidates[candidates.length - 1]],
          factorsFor: (_name, v1) => [...(v1 ?? [])],
        }),
      };
      const v1 = names(buildSubstitutionOptions([staple], pool, new Set<string>(), DIMIR, {}, 5));
      const v2 = names(
        buildSubstitutionOptions([staple], pool, new Set<string>(), DIMIR, { rerank: lastOnly }, 5)
      );
      expect(v2).toEqual([v1[v1.length - 1], ...v1.slice(0, -1)]);
    });
  });
});
