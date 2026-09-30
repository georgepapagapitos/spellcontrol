// E511: every tag on EDHREC's theme and typal lists resolves in the strategy
// vocabulary. A tag with neither an archetype nor a non-strategy ruling fails
// here by name, so a refreshed snapshot surfaces what EDHREC added.
import { describe, it, expect } from 'vitest';
import { EDHREC_TAGS, EDHREC_TAGS_SNAPSHOT_DATE } from './edhrecTags.fixtures';
import { nonStrategyReason, themeArchetype, themeAxes, typalArchetype } from './strategyVocabulary';
import { resolveCreatureType, typalPayoffType } from '@/deck-builder/services/synergy/text';
import { classifyCard } from '@/deck-builder/services/synergy/classify';

describe(`EDHREC tag coverage (snapshot ${EDHREC_TAGS_SNAPSHOT_DATE})`, () => {
  it('holds both full lists', () => {
    expect(EDHREC_TAGS.filter((t) => t.list === 'themes')).toHaveLength(269);
    expect(EDHREC_TAGS.filter((t) => t.list === 'typal')).toHaveLength(131);
  });

  it('gives every tag an archetype or a non-strategy ruling, never both', () => {
    const unruled = EDHREC_TAGS.filter(
      (t) => themeArchetype(t.name) === undefined && nonStrategyReason(t.name) === undefined
    ).map((t) => t.name);
    expect(unruled).toEqual([]);
    const both = EDHREC_TAGS.filter(
      (t) => themeArchetype(t.name) !== undefined && nonStrategyReason(t.name) !== undefined
    ).map((t) => t.name);
    expect(both).toEqual([]);
  });

  it('matches the table row for row', () => {
    for (const t of EDHREC_TAGS) {
      expect({
        name: t.name,
        archetype: themeArchetype(t.name),
        ruling: nonStrategyReason(t.name),
        axes: [...themeAxes(t.name)],
      }).toEqual({ name: t.name, archetype: t.archetype, ruling: t.ruling, axes: t.axes });
    }
  });

  it('resolves every typal tag through the tribal path', () => {
    for (const t of EDHREC_TAGS.filter((x) => x.list === 'typal')) {
      const tribe = resolveCreatureType(t.name);
      expect({ name: t.name, tribe }).toEqual({ name: t.name, tribe: t.tribe });
      if (!tribe) continue;
      // EDHREC's own spelling, in the lord template Oracle text uses, reads
      // as a payoff for that tribe, and the engine builds what the tag names.
      expect({
        name: t.name,
        payoff: typalPayoffType(`other ${t.name.toLowerCase()} you control get +1/+1.`),
      }).toEqual({
        name: t.name,
        payoff: tribe,
      });
      expect({ name: t.name, builds: typalArchetype(tribe) }).toEqual({
        name: t.name,
        builds: t.archetype,
      });
    }
  });

  it('reads changelings and "choose a creature type" cards as typal producers for any tribe', () => {
    // Real Oracle text: Mirror Entity is a changeling; Herald's Horn chooses a type.
    const mirrorEntity = {
      name: 'Mirror Entity',
      type_line: 'Creature — Shapeshifter',
      keywords: ['Changeling'],
      oracle_text:
        'Changeling (This card is every creature type.)\n{X}: Until end of turn, creatures you control have base power and toughness X/X and gain all creature types.',
    };
    const heraldsHorn = {
      name: "Herald's Horn",
      type_line: 'Artifact',
      keywords: [],
      oracle_text:
        "As this artifact enters, choose a creature type.\nCreature spells you cast of the chosen type cost {1} less to cast.\nAt the beginning of your upkeep, look at the top card of your library. If it's a creature card of the chosen type, you may reveal it and put it into your hand.",
    };
    for (const card of [mirrorEntity, heraldsHorn]) {
      expect(classifyCard(card).producers.map((p) => p.axis)).toContain('tribal');
    }
  });
});
