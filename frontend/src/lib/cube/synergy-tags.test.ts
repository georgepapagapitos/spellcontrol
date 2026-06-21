import { describe, it, expect } from 'vitest';
import { synergyTags } from './synergy-tags';

describe('synergyTags', () => {
  it('delegates to the classifier for non-spell cards', () => {
    // Ashnod's Altar is an Artifact, so the spellslinger patch never fires —
    // the result is exactly what classifyCard returns.
    const tags = synergyTags({
      name: "Ashnod's Altar",
      type_line: 'Artifact',
      oracle_text: 'Sacrifice a creature: Add {C}{C}.',
      keywords: [],
    });
    expect(tags.synergyProducers).toEqual(['sacrifice']);
    expect(tags.synergyPayoffs).toEqual([]);
  });

  it('treats every instant/sorcery as a spellslinger enabler (cube patch)', () => {
    const bolt = synergyTags({
      name: 'Lightning Bolt',
      type_line: 'Instant',
      oracle_text: 'Lightning Bolt deals 3 damage to any target.',
      keywords: [],
    });
    expect(bolt.synergyProducers).toContain('spellslinger');

    const sorc = synergyTags({
      name: 'Divination',
      type_line: 'Sorcery',
      oracle_text: 'Draw two cards.',
    });
    expect(sorc.synergyProducers).toContain('spellslinger');
  });

  it('does not add spellslinger to permanents', () => {
    const bear = synergyTags({
      name: 'Grizzly Bears',
      type_line: 'Creature — Bear',
      oracle_text: '',
    });
    expect(bear.synergyProducers).not.toContain('spellslinger');
    expect(bear.synergyProducers).toEqual([]);
    expect(bear.synergyPayoffs).toEqual([]);
  });

  it('does not duplicate spellslinger when the classifier already tagged it', () => {
    // A cost-reducer instant/sorcery the classifier tags spellslinger itself.
    const tags = synergyTags({
      name: 'Cost Reducer Test',
      type_line: 'Instant',
      oracle_text: 'Instant and sorcery spells you cast cost {1} less to cast.',
      keywords: [],
    });
    const count = tags.synergyProducers.filter((a) => a === 'spellslinger').length;
    expect(count).toBe(1);
  });
});
