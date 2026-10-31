import { beforeEach, describe, expect, it, vi } from 'vitest';

const reportError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/util/analytics', () => ({ reportError }));

import { parseCardLiftPool, parseEdhrecResponse, parseSaltIndex } from './client';
import { isKnownCardlistTag, resetDriftReports } from './drift';
import page from './__fixtures__/commander-page-sythis.fixture.json';
import cardPage from './__fixtures__/card-page-the-one-ring.fixture.json';

type Raw = Parameters<typeof parseEdhrecResponse>[0];
type Cardview = Record<string, unknown>;
type Lists = Array<{ tag: string; cardviews: Cardview[] }>;

// Real cardviews from json.edhrec.com/pages/commanders/sythis-harvests-hand.json
// (2026-10-31), four per list.
const live = (): Raw => structuredClone(page) as unknown as Raw;
const lists = (r: Raw): Lists =>
  (r as unknown as { container: { json_dict: { cardlists: Lists } } }).container.json_dict
    .cardlists;
const messages = () => reportError.mock.calls.map((c) => (c[1] as { message: string }).message);

beforeEach(() => {
  reportError.mockClear();
  resetDriftReports();
});

describe('EDHREC drift reports', () => {
  it('stays silent on the current live commander page', () => {
    parseEdhrecResponse(live(), 'sythis-harvests-hand');
    expect(reportError).not.toHaveBeenCalled();
  });

  it('stays silent on the live card page', () => {
    parseCardLiftPool(cardPage as unknown as Parameters<typeof parseCardLiftPool>[0]);
    expect(reportError).not.toHaveBeenCalled();
  });

  it('knows every tag on the live page', () => {
    for (const l of lists(live())) expect(isKnownCardlistTag(l.tag)).toBe(true);
  });

  it('reports an unknown cardlist tag as a counted client error', () => {
    const raw = live();
    lists(raw).push({ tag: 'highsynergycardz', cardviews: lists(raw)[0].cardviews });
    const before = parseEdhrecResponse(live(), 'x').cardlists.allNonLand.length;
    const after = parseEdhrecResponse(raw, 'x').cardlists.allNonLand.length;
    expect(after).toBe(before);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0][0]).toBe('error');
    expect(messages()[0]).toContain('unknown cardlist tag "highsynergycardz"');
  });

  it('treats builtin property names as unknown tags, with no implied type', () => {
    const raw = live();
    lists(raw).push({
      tag: 'constructor',
      cardviews: [{ name: 'Proto Card', num_decks: 9000, potential_decks: 10000 }],
    });
    const card = parseEdhrecResponse(raw, 'x').cardlists.allNonLand.find(
      (c) => c.name === 'Proto Card'
    );
    expect(isKnownCardlistTag('constructor')).toBe(false);
    expect(isKnownCardlistTag('__proto__')).toBe(false);
    expect(card).toBeUndefined();
    expect(messages()).toEqual(['EDHREC drift (cardlists): unknown cardlist tag "constructor"']);
  });

  it('never echoes upstream text that does not look like a tag', () => {
    const raw = live();
    lists(raw).push({ tag: 'evil"\n<script>', cardviews: lists(raw)[0].cardviews });
    parseEdhrecResponse(raw, 'x');
    expect(messages()).toEqual([
      'EDHREC drift (cardlists): unknown cardlist tag "evil%22%0A%3Cscript%3E"',
    ]);
  });

  it('reports one unknown tag per load so real errors keep their budget', () => {
    const raw = live();
    for (const tag of ['a1', 'a2', 'a3', 'a4', 'a5'])
      lists(raw).push({ tag, cardviews: lists(raw)[0].cardviews });
    parseEdhrecResponse(raw, 'x');
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it('new tags never crowd out a missing field', () => {
    const raw = live();
    for (const tag of ['a1', 'a2', 'a3', 'a4', 'a5'])
      lists(raw).push({ tag, cardviews: [] as Cardview[] });
    for (const l of lists(raw)) l.cardviews = l.cardviews.length ? l.cardviews : [{}];
    for (const l of lists(raw))
      for (const c of l.cardviews) {
        delete c.synergy;
        delete c.lift;
      }
    parseEdhrecResponse(raw, 'x');
    expect(messages().some((m) => m.includes('synergy-or-lift missing'))).toBe(true);
  });

  it('reports when synergy and lift are gone from every cardview, once', () => {
    const raw = live();
    for (const l of lists(raw)) {
      for (const c of l.cardviews) {
        delete c.synergy;
        delete c.lift;
      }
    }
    const parsed = parseEdhrecResponse(raw, 'x');
    expect(parsed.cardlists.creatures.length).toBeGreaterThan(0); // parse unchanged
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(messages()[0]).toContain('synergy-or-lift missing');
  });

  it('dedupes one signature across parses, but not different signatures', () => {
    const strip = (field: string) => {
      const raw = live();
      for (const l of lists(raw)) for (const c of l.cardviews) delete c[field];
      return raw;
    };
    parseEdhrecResponse(strip('potential_decks'), 'a');
    parseEdhrecResponse(strip('potential_decks'), 'b');
    expect(reportError).toHaveBeenCalledTimes(1);
    parseEdhrecResponse(strip('num_decks'), 'c');
    expect(reportError).toHaveBeenCalledTimes(2);
  });

  it('does not report a field missing on a minority of cardviews', () => {
    const raw = live();
    for (const c of lists(raw)[3].cardviews) delete c.lift; // 4 of 44, synergy remains
    parseEdhrecResponse(raw, 'x');
    expect(reportError).not.toHaveBeenCalled();
  });

  it('reports a salt page that lost its number', () => {
    const live1 = Array.from({ length: 12 }, (_, i) => ({ name: `C${i}`, salt: 3.05 + i }));
    expect(parseSaltIndex(live1).size).toBe(12);
    expect(reportError).not.toHaveBeenCalled();
    const stripped = live1.map(({ name }) => ({ name }));
    expect(parseSaltIndex(stripped).size).toBe(0);
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(messages()[0]).toContain('(salt)');
  });
});
