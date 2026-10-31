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
});
