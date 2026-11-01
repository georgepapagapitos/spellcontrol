import { describe, expect, it } from 'vitest';
import { parsePerturbation, perturbEdhrecBody } from './liveGenPerturb';

const PAGE = 'https://json.edhrec.com/pages/commanders/krenko-mob-boss.json';
const page = () =>
  JSON.stringify({
    container: {
      json_dict: {
        cardlists: [
          {
            tag: 'utilityartifacts',
            cardviews: [
              { name: 'A', num_decks: 50, potential_decks: 100 },
              { name: 'B', num_decks: 50, potential_decks: 100 },
              { name: 'C', num_decks: 50, potential_decks: 100 },
              { name: 'D', num_decks: 50, potential_decks: 100 },
              { name: 'E', num_decks: 50, potential_decks: 100 },
            ],
          },
        ],
      },
    },
  });
const names = (body: string) =>
  JSON.parse(body).container.json_dict.cardlists[0].cardviews.map((c: { name: string }) => c.name);

describe('live panel perturbations (E1061)', () => {
  it('parses each kind and rejects the rest', () => {
    expect(parsePerturbation(undefined)).toEqual({ kind: 'none' });
    expect(parsePerturbation('shuffle:7')).toEqual({ kind: 'shuffle', seed: 7 });
    expect(parsePerturbation('add:Ornithopter@1')).toEqual({
      kind: 'add',
      name: 'Ornithopter',
      pct: 1,
      list: 'utilityartifacts',
    });
    expect(parsePerturbation('seed:5')).toEqual({ kind: 'seed', seed: 5 });
    expect(() => parsePerturbation('add:X')).toThrow();
    expect(() => parsePerturbation('wiggle')).toThrow();
  });

  it('leaves the body alone for none, seed and non-card pages', () => {
    const body = page();
    expect(perturbEdhrecBody(body, { kind: 'none' }, PAGE)).toBe(body);
    expect(perturbEdhrecBody(body, { kind: 'seed', seed: 1 }, PAGE)).toBe(body);
    expect(perturbEdhrecBody('{"a":1}', { kind: 'shuffle', seed: 1 }, PAGE)).toBe('{"a":1}');
  });

  it('leaves card pages alone', () => {
    const body = page();
    expect(
      perturbEdhrecBody(body, { kind: 'shuffle', seed: 3 }, 'https://x/pages/cards/sol-ring.json')
    ).toBe(body);
  });

  it('shuffles deterministically and keeps the same cards', () => {
    const a = names(perturbEdhrecBody(page(), { kind: 'shuffle', seed: 3 }, PAGE));
    const b = names(perturbEdhrecBody(page(), { kind: 'shuffle', seed: 3 }, PAGE));
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(a).not.toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('seats a floor card at the page minimum, so the floor does not move', () => {
    const body = JSON.stringify({
      container: {
        json_dict: {
          cardlists: [
            {
              tag: 'utilityartifacts',
              cardviews: [
                { name: 'A', num_decks: 50, potential_decks: 100 },
                { name: 'B', num_decks: 8, potential_decks: 100 },
              ],
            },
          ],
        },
      },
    });
    const out = perturbEdhrecBody(body, parsePerturbation('add:Black Lotus@floor'), PAGE);
    expect(JSON.parse(out).container.json_dict.cardlists[0].cardviews.at(-1).num_decks).toBe(8);
  });

  it('adds one card at the asked inclusion, once', () => {
    const p = parsePerturbation('add:Ornithopter@1');
    const out = perturbEdhrecBody(page(), p, PAGE);
    const view = JSON.parse(out).container.json_dict.cardlists[0].cardviews.at(-1);
    expect(view).toMatchObject({ name: 'Ornithopter', num_decks: 1, potential_decks: 100 });
    expect(names(perturbEdhrecBody(out, p, PAGE))).toHaveLength(6);
  });

  it('adds a card with no synergy or lift of its own, whatever the neighbour carries', () => {
    // The clone template is the list's top card; copying its synergy made a 1% card
    // outrank 30% ones (Ornithopter at 1.2% scored 46 against 47 for a 33% card).
    const body = JSON.stringify({
      container: {
        json_dict: {
          cardlists: [
            {
              tag: 'utilityartifacts',
              cardviews: [
                { name: 'A', num_decks: 50, potential_decks: 100, synergy: 0.45, lift: 1.6 },
              ],
            },
          ],
        },
      },
    });
    const out = perturbEdhrecBody(body, parsePerturbation('add:Ornithopter@1'), PAGE);
    const view = JSON.parse(out).container.json_dict.cardlists[0].cardviews.at(-1);
    expect(view.synergy).toBe(0);
    expect(view.lift).toBeUndefined();
  });

  it('drift moves each card by a bounded, repeatable amount and keeps the cards', () => {
    const p = parsePerturbation('drift:1@3');
    expect(p).toEqual({ kind: 'drift', points: 1, seed: 3 });
    expect(parsePerturbation('drift:2')).toEqual({ kind: 'drift', points: 2, seed: 0 });
    expect(() => parsePerturbation('drift:abc')).toThrow();
    const body = JSON.stringify({
      container: {
        json_dict: {
          cardlists: [
            {
              tag: 'x',
              cardviews: ['A', 'B', 'C', 'D', 'E', 'F'].map((name) => ({
                name,
                num_decks: 500,
                potential_decks: 1000,
              })),
            },
          ],
        },
      },
    });
    const a = perturbEdhrecBody(body, p, PAGE);
    expect(perturbEdhrecBody(body, p, PAGE)).toBe(a);
    const views = JSON.parse(a).container.json_dict.cardlists[0].cardviews as {
      name: string;
      num_decks: number;
    }[];
    expect(views.map((v) => v.name)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    for (const v of views) expect(Math.abs(v.num_decks - 500)).toBeLessThanOrEqual(10);
    expect(views.some((v) => v.num_decks !== 500)).toBe(true);
    expect(new Set(views.map((v) => v.num_decks)).size).toBeGreaterThan(1);
    expect(perturbEdhrecBody(body, p, 'https://x/pages/cards/sol-ring.json')).toBe(body);
    expect(perturbEdhrecBody(body, { kind: 'drift', points: 1, seed: 4 }, PAGE)).not.toBe(a);
  });
});
