import { describe, it, expect } from 'vitest';
import { buildTermLookup, type GlossaryTerm } from './rules-glossary';

// Shaped like the generated rules-glossary.json (tests never read the file);
// the definitions are the Comprehensive Rules' own.
const TERMS: GlossaryTerm[] = [
  {
    term: 'Priority',
    rule: '117',
    text: 'Which player can take actions at any given time is determined by a system of “priority.”',
  },
  {
    term: 'Stack',
    rule: '405',
    text: 'A zone. The stack is the zone in which spells, activated abilities, and triggered abilities wait to resolve.',
  },
  {
    term: 'Mana Value',
    rule: '202.3',
    text: 'The total amount of mana in a mana cost, regardless of color.',
  },
  {
    term: 'State-Based Actions',
    rule: '704',
    text: 'Game actions that happen automatically whenever certain conditions are met.',
  },
  { term: 'Owner’s Turn', text: 'A turn of the owner of a card.' },
];

const lookup = buildTermLookup(TERMS);
const term = (q: string) => lookup(q)?.term ?? null;

describe('buildTermLookup', () => {
  it('finds a term by its exact name in any case and spacing', () => {
    expect(term('priority')).toBe('Priority');
    expect(term('  MANA   value ')).toBe('Mana Value');
    expect(term('state-based actions')).toBe('State-Based Actions');
  });

  it('reads "the stack" as Stack, and either apostrophe', () => {
    expect(term('the stack')).toBe('Stack');
    expect(term("owner's turn")).toBe('Owner’s Turn');
  });

  it('never reads a longer query, a partial term or a short one as a term', () => {
    expect(term('stack of cards')).toBeNull();
    expect(term('mana')).toBeNull();
    expect(term('priorit')).toBeNull();
    expect(term('st')).toBeNull();
  });
});
