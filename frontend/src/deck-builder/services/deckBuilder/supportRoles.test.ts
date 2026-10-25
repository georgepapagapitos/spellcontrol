import { describe, expect, it, vi } from 'vitest';
import type { RoleFact } from '@/deck-builder/services/cardFacts';
import {
  summarizeSupportRoles,
  supportRoleEvidence,
  supportRolesOf,
  type SupportRole,
} from './supportRoles';
import { REAL } from './supportRoles.fixtures';

// Card-facts decides the first gate; stub it per test so these tests pin the
// oracle-text gate and the combination, not the snapshot.
const facts = vi.hoisted(() => ({ byName: new Map<string, Partial<RoleFact>[]>() }));
vi.mock('@/deck-builder/services/cardFacts', () => ({
  getRoleFacts: (card: { name: string }) => facts.byName.get(card.name) ?? [],
}));

const c = (name: string) => REAL[name];
const holds = (role: SupportRole, name: string, subs: string[] = []) =>
  supportRoleEvidence(role, c(name), subs);

describe('support role evidence, real oracle text', () => {
  it('tutor: any non-land search, never a land search', () => {
    for (const n of ['Demonic Tutor', 'Worldly Tutor', 'Vampiric Tutor'])
      expect(holds('tutor', n), n).toBe(true);
    for (const n of ['Evolving Wilds', 'Rampant Growth', 'Sakura-Tribe Elder', 'Cultivate'])
      expect(holds('tutor', n), n).toBe(false);
  });

  it('protection: grants to your stuff, not other people removal', () => {
    for (const n of [
      'Heroic Intervention',
      'Lightning Greaves',
      "Teferi's Protection",
      'Swiftfoot Boots',
    ])
      expect(holds('protection', n), n).toBe(true);
    for (const n of ['Swords to Plowshares', 'Beast Within', 'Demonic Tutor'])
      expect(holds('protection', n), n).toBe(false);
  });

  it('graveyard hate: other graveyards only, never your own', () => {
    for (const n of ['Scavenging Ooze', 'Rest in Peace', 'Bojuka Bog', "Tormod's Crypt"])
      expect(holds('graveyardHate', n), n).toBe(true);
    for (const n of ['Murktide Regent', 'Eternal Witness', 'Reanimate'])
      expect(holds('graveyardHate', n), n).toBe(false);
  });

  it('recursion: returns another card, not itself or a land-only fetch', () => {
    for (const n of ['Eternal Witness', 'Reanimate']) expect(holds('recursion', n), n).toBe(true);
    for (const n of ['Gravecrawler', 'Dread Wanderer', 'Sol Ring', 'Demonic Tutor'])
      expect(holds('recursion', n), n).toBe(false);
  });

  it('win condition: needs the text behind the finisher kind', () => {
    expect(holds('winCon', 'Craterhoof Behemoth', ['overrun'])).toBe(true);
    expect(holds('winCon', "Thassa's Oracle", ['alt-win'])).toBe(true);
    expect(holds('winCon', 'Exsanguinate', ['drain'])).toBe(true);
    expect(holds('winCon', 'Aurelia, the Warleader', ['extra-combat'])).toBe(true);
    // A bare +2/+0 pump, and an extra turn that loses you the game, are not.
    expect(holds('winCon', 'Burn Bright', ['overrun'])).toBe(false);
    expect(holds('winCon', 'Final Fortune', ['extra-turn'])).toBe(false);
    // No finisher kind from card facts, no win condition.
    expect(holds('winCon', 'Craterhoof Behemoth', [])).toBe(false);
  });

  it('mana sink: a repeatable mana-only ability that scales, not a one-shot', () => {
    for (const n of ['Steel Hellkite', 'Pestilence', 'Thrashing Wumpus'])
      expect(holds('manaSink', n), n).toBe(true);
    for (const n of [
      'Dread Wanderer',
      'Thrun, the Last Troll',
      'Nessian Asp',
      'Sorcerer Class',
      'Sol Ring',
    ])
      expect(holds('manaSink', n), n).toBe(false);
  });

  it('says nothing without oracle text', () => {
    const blank = { name: 'Demonic Tutor' };
    expect(supportRoleEvidence('tutor', blank)).toBe(false);
  });
});

describe('supportRolesOf and summarizeSupportRoles', () => {
  const fact = (role: RoleFact['role'], sub: string | null = null): Partial<RoleFact> => ({
    role,
    sub: sub as RoleFact['sub'],
    tier: 'primary',
  });

  it('needs the card-facts role AND the oracle evidence', () => {
    facts.byName.clear();
    facts.byName.set('Demonic Tutor', [fact('tutor')]);
    // A tutor tagged by facts whose text is not a tutor (a mismatched record).
    facts.byName.set('Sol Ring', [fact('tutor')]);
    // Text that would earn the role, but facts never named it.
    expect(supportRolesOf(c('Worldly Tutor'))).toEqual([]);
    expect(supportRolesOf(c('Demonic Tutor'))).toEqual(['tutor']);
    expect(supportRolesOf(c('Sol Ring'))).toEqual([]);
  });

  it('lets one card fill several roles, and mana sinks need no facts role', () => {
    facts.byName.clear();
    facts.byName.set('Scavenging Ooze', [fact('graveyardHate')]);
    expect(supportRolesOf(c('Scavenging Ooze')).sort()).toEqual(['graveyardHate', 'manaSink']);
  });

  it('summarizes only roles with a card, once per name', () => {
    facts.byName.clear();
    facts.byName.set('Demonic Tutor', [fact('tutor')]);
    const out = summarizeSupportRoles([c('Demonic Tutor'), c('Demonic Tutor'), c('Sol Ring')]);
    expect(out).toEqual([{ role: 'tutor', label: 'Tutors', names: ['Demonic Tutor'] }]);
  });

  it('is empty when card facts are not loaded', () => {
    facts.byName.clear();
    expect(
      summarizeSupportRoles([c('Demonic Tutor'), c('Steel Hellkite')]).map((s) => s.role)
    ).toEqual(['manaSink']);
  });
});
