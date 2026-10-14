import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildCommanderProfile,
  voltronVetoed,
  type CommanderProfileTheme,
} from '@/deck-builder/services/deckBuilder/commanderProfile';
import type { ScryfallCard } from '@/deck-builder/types';
import golden from '@/deck-builder/services/deckBuilder/__fixtures__/commander-profile.golden.fixture.json';
import heldout from '@/deck-builder/services/deckBuilder/__fixtures__/commander-profile.heldout.fixture.json';
import { VETOED_COMMANDERS } from '@/deck-builder/services/deckBuilder/__fixtures__/vetoed-commanders';
import { isVoltronCandidate, isVoltronVetoed } from '../../../scripts/voltron-veto-lib.mjs';
import { classifyCommanderPlaystyles } from './commander-playstyle-index';
import { voltronVetoKey } from './commander-voltron-veto';

// The playstyle index (finder and collection "Plays like" chips, the Voltron filter) and the
// commander profile are two readers of one rule (golden R11). The profile applies EDHREC's
// veto from the commander's page; the index applies it from the shipped snapshot
// (public/voltron-veto.json, scripts/refresh-voltron-veto.mjs). Both must give one answer.

type Fixture = {
  cards: Record<string, Omit<ScryfallCard, 'name'>>;
  edhrecThemes: Record<string, string>;
};
const sets = [golden, heldout] as unknown as Fixture[];

function themesOf(row: string): CommanderProfileTheme[] {
  return row.split(' | ').map((pair) => {
    const at = pair.lastIndexOf(':');
    const name = pair.slice(0, at);
    return {
      name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      count: Number(pair.slice(at + 1)),
    };
  });
}

const commanders = sets.flatMap((fx) =>
  Object.entries(fx.edhrecThemes).flatMap(([name, row]) => {
    const card = fx.cards[name];
    return card ? [{ name, card: { name, ...card } as ScryfallCard, themes: themesOf(row) }] : [];
  })
);

const CONTROLS = [
  'Questing Beast',
  'Zetalpa, Primal Dawn',
  'Danitha Capashen, Paragon',
  'Akroma, Angel of Wrath',
];

const hasVoltronAbility = (p: { abilities: Array<{ keyword: string }> }) =>
  p.abilities.some((a) => a.keyword === 'voltron');
const listsVoltron = (card: ScryfallCard, vetoed: boolean) =>
  classifyCommanderPlaystyles(card, { voltronVetoed: vetoed }).some(
    (m) => m.playstyle.id === 'voltron'
  );

describe('Voltron veto: index and profile agree', () => {
  it('covers a real fixture set', () => {
    expect(commanders.length).toBeGreaterThan(700);
  });

  it('the refresh script applies the same rule as the profile', () => {
    for (const { name, themes } of commanders) {
      expect(isVoltronVetoed(themes), name).toBe(voltronVetoed(themes));
    }
  });

  it('a vetoed commander is voltron in neither the profile nor the index', () => {
    let vetoedTextVoltron = 0;
    for (const { name, card, themes } of commanders) {
      if (!voltronVetoed(themes)) continue;
      if (hasVoltronAbility(buildCommanderProfile(card))) vetoedTextVoltron++;
      const profile = buildCommanderProfile(card, null, { edhrecThemes: themes });
      expect(hasVoltronAbility(profile), `${name} profile`).toBe(false);
      expect(listsVoltron(card, true), `${name} index`).toBe(false);
    }
    // Not vacuous: the veto removed real text-only voltron readings.
    expect(vetoedTextVoltron).toBeGreaterThan(15);
  });

  it('an unvetoed commander reads exactly as before', () => {
    for (const { name, card, themes } of commanders) {
      if (voltronVetoed(themes)) continue;
      expect(classifyCommanderPlaystyles(card, { voltronVetoed: false }), name).toEqual(
        classifyCommanderPlaystyles(card)
      );
    }
  });

  it.each(VETOED_COMMANDERS)(
    '%s: the text reads voltron, the veto removes it everywhere',
    (name) => {
      const entry = commanders.find((c) => c.name === name)!;
      expect(hasVoltronAbility(buildCommanderProfile(entry.card))).toBe(true);
      expect(listsVoltron(entry.card, false)).toBe(true);
      const profile = buildCommanderProfile(entry.card, null, { voltronVetoed: true });
      expect(hasVoltronAbility(profile)).toBe(false);
      expect(profile.voltronVetoed).toBe(true);
      expect(listsVoltron(entry.card, true)).toBe(false);
    }
  );

  it.each(CONTROLS)('%s: a true voltron commander stays voltron', (name) => {
    const entry = commanders.find((c) => c.name === name);
    expect(entry, `${name} is in the fixtures`).toBeTruthy();
    expect(voltronVetoed(entry!.themes)).toBe(false);
    const profile = buildCommanderProfile(entry!.card, null, { edhrecThemes: entry!.themes });
    expect(hasVoltronAbility(profile)).toBe(true);
    expect(profile.voltronVetoed).toBeUndefined();
    expect(listsVoltron(entry!.card, false)).toBe(true);
  });
});

describe('the refresh script screens in every commander the veto can touch', () => {
  it('every vetoed commander whose text reads voltron passes the candidate screen', () => {
    for (const { name, card, themes } of commanders) {
      if (!voltronVetoed(themes) || !hasVoltronAbility(buildCommanderProfile(card))) continue;
      expect(isVoltronCandidate(card), name).toBe(true);
    }
  });
});

describe('the shipped snapshot (public/voltron-veto.json)', () => {
  const snap = JSON.parse(
    readFileSync(resolve(__dirname, '../../../public/voltron-veto.json'), 'utf8')
  ) as { names: string[]; count: number; generatedAt: string };
  const names = new Set(snap.names);

  it('is a sorted, de-duplicated list of snapshot keys', () => {
    expect(snap.count).toBe(snap.names.length);
    expect(snap.names).toEqual([...names].sort());
    expect(snap.names.every((n) => n === n.toLowerCase() && !n.includes(' // '))).toBe(true);
    expect(Number.isFinite(Date.parse(snap.generatedAt))).toBe(true);
  });

  it.each(VETOED_COMMANDERS)('lists %s', (name) => {
    expect(names.has(voltronVetoKey(name))).toBe(true);
  });

  it.each(CONTROLS)('does not list the true voltron commander %s', (name) => {
    expect(names.has(voltronVetoKey(name))).toBe(false);
  });

  it('agrees with the index for every fixture commander the snapshot names', () => {
    let seen = 0;
    for (const { name, card } of commanders) {
      if (!names.has(voltronVetoKey(name))) continue;
      seen++;
      expect(listsVoltron(card, true), name).toBe(false);
    }
    expect(seen).toBeGreaterThan(15);
  });

  it('matches the fixtures page-for-page where both know the commander', () => {
    // The fixtures hold EDHREC pages from 2026-10-13; the snapshot is refreshed on schedule, so
    // allow drift at the edge of the 4% line but not a wholesale disagreement.
    let agree = 0;
    let total = 0;
    for (const { name, card, themes } of commanders) {
      if (!isVoltronCandidate(card)) continue;
      total++;
      if (names.has(voltronVetoKey(name)) === voltronVetoed(themes)) agree++;
    }
    expect(agree / total).toBeGreaterThan(0.95);
  });
});
