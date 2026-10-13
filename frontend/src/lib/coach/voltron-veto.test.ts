// @vitest-environment node
/**
 * Coach and the Coach objective read the commander's profile to decide what "feeds the
 * commander" and whether it has to survive or connect. Those readings must match the deck page
 * and the generator: a commander whose EDHREC page vetoes voltron (golden.md R11) is not held
 * to a voltron plan once the page is cached, and keeps the text reading when it is not.
 */
import { describe, expect, it } from 'vitest';
import type { ScryfallCard } from '@/deck-builder/types';
import {
  vetoedCard,
  vetoedPage,
} from '@/deck-builder/services/deckBuilder/__fixtures__/vetoed-commanders';
import { buildCommanderProfileFromCache } from '@/deck-builder/services/deckBuilder/commanderProfileCached';
import { commanderMustSurvive } from '@/deck-builder/services/deckBuilder/deckObjective/factsReading';
import { createCoachProtections } from './coach-protections';

const isVoltron = (c: ScryfallCard) =>
  buildCommanderProfileFromCache(c).abilities.some((a) => a.keyword === 'voltron');

// Real Oracle text (Scryfall).
const BONESPLITTER = {
  id: 'bonesplitter',
  name: 'Bonesplitter',
  type_line: 'Artifact — Equipment',
  oracle_text: 'Equipped creature gets +2/+0.\nEquip {1}',
  cmc: 1,
  color_identity: [],
} as unknown as ScryfallCard;

const protectionFor = (commander: ScryfallCard) =>
  createCoachProtections({
    commanders: [commander],
    invested: [],
    inclusionOf: () => undefined,
    gameChangerNames: new Set<string>(),
  })(BONESPLITTER)?.cls;

describe('Coach reads the same voltron answer as the deck page', () => {
  it('the cached-profile builder falls back to text, then applies the page veto', () => {
    const gisela = vetoedCard('Gisela, Blade of Goldnight');
    expect(isVoltron(gisela)).toBe(true);
    vetoedPage(gisela.name);
    expect(isVoltron(gisela)).toBe(false);
  });

  it('protections hold a voltron-plan card until the page vetoes the plan', () => {
    const gishath = vetoedCard("Gishath, Sun's Avatar");
    expect(protectionFor(gishath)).toBe('commander plan');
    vetoedPage(gishath.name);
    expect(protectionFor(gishath)).not.toBe('commander plan');
  });

  it('the objective stops asking a vetoed commander to connect, and re-reads once the page lands', () => {
    const emrakul = vetoedCard('Emrakul, the Promised End');
    expect(commanderMustSurvive([emrakul])).toBe(true);
    vetoedPage(emrakul.name);
    expect(commanderMustSurvive([emrakul])).toBe(false);
  });
});
