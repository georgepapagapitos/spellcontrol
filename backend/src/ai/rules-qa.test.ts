import { describe, it, expect } from 'vitest';
import type { ScryfallCache } from '../cache';
import { RulesIndex } from '../rules';
import {
  ANSWER_MARK,
  citedRuleRefs,
  getRuleTool,
  hashRulesQaInput,
  lookupCardTool,
  makeAnswerGate,
  parseRulesQuestion,
  renderFetchedRules,
  searchRulesTool,
  stripAnswerMark,
} from './rules-qa';

const makeIndex = (): RulesIndex => {
  const index = new RulesIndex(':memory:');
  index.replaceAll(
    [
      { ref: '704', body: 'State-Based Actions' },
      { ref: '704.5', body: 'The state-based actions are as follows:' },
      { ref: '704.5g', body: 'A creature dealt lethal damage is destroyed.' },
      { ref: 'Deathtouch', body: 'A keyword ability. See rule 702.2.' },
    ],
    { sourceUrl: 'test', effectiveDate: 'Test' }
  );
  return index;
};

describe('parseRulesQuestion', () => {
  it('accepts a trimmed question', () => {
    const parsed = parseRulesQuestion({ question: '  Does deathtouch kill?  ' });
    expect(parsed).toEqual({ ok: true, value: { question: 'Does deathtouch kill?' } });
  });

  it('rejects a missing, empty or oversized question', () => {
    expect(parseRulesQuestion(null).ok).toBe(false);
    expect(parseRulesQuestion({}).ok).toBe(false);
    expect(parseRulesQuestion({ question: '   ' }).ok).toBe(false);
    expect(parseRulesQuestion({ question: 'x'.repeat(501) }).ok).toBe(false);
  });
});

describe('hashRulesQaInput', () => {
  it('normalises case and whitespace so trivially equal questions share a cache row', () => {
    expect(hashRulesQaInput('Can I  respond?')).toBe(hashRulesQaInput('can i respond?'));
    expect(hashRulesQaInput('Can I respond?')).not.toBe(hashRulesQaInput('Can I respond now?'));
  });
});

describe('citedRuleRefs', () => {
  it('finds each cited rule once, in order of first appearance', () => {
    expect(citedRuleRefs('See (704.5g) and 601.2b, then 704.5g again.')).toEqual([
      '704.5g',
      '601.2b',
    ]);
  });

  it('does not misread years or card stats as rules', () => {
    expect(citedRuleRefs('In 2026 a 1/1 creature died. No rules here.')).toEqual([]);
  });
});

describe('renderFetchedRules', () => {
  it('renders deduped one-line rules, and nothing for an empty list', () => {
    expect(renderFetchedRules([])).toBe('');
    const out = renderFetchedRules([
      { ref: '704.5g', body: 'Line one.\nLine two.' },
      { ref: '704.5g', body: 'Line one.\nLine two.' },
    ]);
    expect(out).toContain('704.5g: Line one. Line two.');
    expect(out.match(/704\.5g/g)).toHaveLength(1);
  });
});

describe('stripAnswerMark / makeAnswerGate', () => {
  it('strips the opening marker and its trailing whitespace', () => {
    expect(stripAnswerMark(`${ANSWER_MARK}\n\nYes (704.5g).`)).toBe('Yes (704.5g).');
    expect(stripAnswerMark('No marker here.')).toBe('No marker here.');
  });

  it('the gate drops a marker that arrives a character at a time', () => {
    const out: string[] = [];
    const gate = makeAnswerGate((t) => out.push(t));
    for (const ch of `${ANSWER_MARK}\n\nYes`) gate(ch);
    gate(' — it dies.');
    expect(out.join('')).toBe('Yes — it dies.');
  });

  it('the gate passes a markerless reply through whole', () => {
    const out: string[] = [];
    const gate = makeAnswerGate((t) => out.push(t));
    gate('A reply without any marker at all.');
    gate(' More text.');
    expect(out.join('')).toBe('A reply without any marker at all. More text.');
  });
});

describe('searchRulesTool / getRuleTool', () => {
  it('search reports hits to the collector and the model', async () => {
    const collected: string[] = [];
    const tool = searchRulesTool(makeIndex(), (r) => collected.push(r.ref));
    const out = await tool.run({ query: 'state-based actions' });
    expect(out.text).toContain('704.5');
    expect(out.fetched).toEqual([]);
    expect(collected).toContain('704.5');
  });

  it('search explains an empty result and a missing query', async () => {
    const tool = searchRulesTool(makeIndex(), () => {});
    expect((await tool.run({ query: 'zzzzzz' })).text).toMatch(/Nothing in the Comprehensive/);
    expect((await tool.run({})).text).toMatch(/No query given/);
  });

  it('get_rule returns a rule family and collects it', async () => {
    const collected: string[] = [];
    const tool = getRuleTool(makeIndex(), (r) => collected.push(r.ref));
    const out = await tool.run({ rule: '704.5' });
    expect(out.text).toContain('704.5g');
    expect(collected).toEqual(['704.5', '704.5g']);
  });

  it('get_rule explains an unknown ref', async () => {
    const tool = getRuleTool(makeIndex(), () => {});
    expect((await tool.run({ rule: '999.9' })).text).toMatch(/No rule or glossary entry/);
  });
});

describe('lookupCardTool', () => {
  const cache = {
    getCheapestByName: (name: string) =>
      name === 'Blood Moon'
        ? {
            id: 'sf-1',
            name: 'Blood Moon',
            mana_cost: '{2}{R}',
            type_line: 'Enchantment',
            oracle_text: 'Nonbasic lands are Mountains.',
          }
        : name === 'Delver of Secrets'
          ? {
              id: 'sf-2',
              name: 'Delver of Secrets // Insectile Aberration',
              card_faces: [
                {
                  name: 'Delver of Secrets',
                  type_line: 'Creature — Human Wizard',
                  oracle_text: 'At the beginning of your upkeep, look at the top card…',
                },
                {
                  name: 'Insectile Aberration',
                  type_line: 'Creature — Human Insect',
                  oracle_text: 'Flying',
                },
              ],
            }
          : null,
    getRulings: (id: string) =>
      id === 'sf-1'
        ? [
            {
              published_at: '2020-01-01',
              comment: 'It affects all nonbasic lands.',
              source: 'wotc',
            },
          ]
        : null,
  } as unknown as ScryfallCache;

  it('returns oracle text plus official rulings and vouches for the card', async () => {
    const out = await lookupCardTool(cache).run({ name: 'Blood Moon' });
    expect(out.text).toContain('Nonbasic lands are Mountains.');
    expect(out.text).toContain('It affects all nonbasic lands.');
    expect(out.fetched).toEqual([
      { name: 'Blood Moon', typeLine: 'Enchantment', oracleText: 'Nonbasic lands are Mountains.' },
    ]);
  });

  it('composes face text for a multi-face card', async () => {
    const out = await lookupCardTool(cache).run({ name: 'Delver of Secrets' });
    expect(out.text).toContain('Flying');
    expect(out.fetched[0].oracleText).toContain('//');
  });

  it('tells the model not to quote a card it cannot verify', async () => {
    const out = await lookupCardTool(cache).run({ name: 'Blood Mon' });
    expect(out.text).toMatch(/could not be verified/);
    expect(out.fetched).toEqual([]);
  });
});
