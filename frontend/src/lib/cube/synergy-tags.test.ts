import { describe, it, expect } from 'vitest';
import { synergyTags } from './synergy-tags';

describe('synergyTags', () => {
  it('delegates to the classifier for non-spell cards', () => {
    const tags = synergyTags({
      name: "Ashnod's Altar",
      type_line: 'Artifact',
      oracle_text: 'Sacrifice a creature: Add {C}{C}.',
      keywords: [],
    });
    expect(tags.synergyProducers).toEqual(['sacrifice']);
    expect(tags.synergyPayoffs).toEqual([]);
  });

  it('does NOT tag a plain instant/sorcery as spellslinger', () => {
    // Spells are universal — counting every one as a spellslinger enabler makes
    // spellslinger the dominant archetype for any collection and floods the
    // high-synergy reserve. A vanilla burn/draw spell carries no axis.
    const bolt = synergyTags({
      name: 'Lightning Bolt',
      type_line: 'Instant',
      oracle_text: 'Lightning Bolt deals 3 damage to any target.',
      keywords: [],
    });
    expect(bolt.synergyProducers).not.toContain('spellslinger');
    expect(bolt.synergyProducers).toEqual([]);

    const sorc = synergyTags({
      name: 'Divination',
      type_line: 'Sorcery',
      oracle_text: 'Draw two cards.',
    });
    expect(sorc.synergyProducers).toEqual([]);
  });

  it('tags a genuine spellslinger enabler (spell-cost reducer)', () => {
    const tags = synergyTags({
      name: 'Goblin Electromancer',
      type_line: 'Creature — Goblin Wizard',
      oracle_text: 'Instant and sorcery spells you cast cost {1} less to cast.',
      keywords: [],
    });
    expect(tags.synergyProducers).toContain('spellslinger');
  });
});
