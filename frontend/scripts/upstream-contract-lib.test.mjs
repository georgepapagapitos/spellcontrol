// Guard for the nightly upstream contract check. Each check passes on a real,
// trimmed response and FAILS on the shape that silently broke a feature before
// (the drift cases are the real fixture with exactly the drifted field changed).
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  checkEdhrecCombos,
  checkEdhrecCommanderPage,
  checkEdhrecSalt,
  checkEdhrecTagPage,
  checkEdhrecTopList,
  checkOracleCardRecord,
  checkOtagRecord,
  checkOtagSearch,
  checkScryfallBulkIndex,
  checkScryfallCard,
  checkSpellbookVariants,
  firstVariants,
  themeListOf,
} from './upstream-contract-lib.mjs';

const fx = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`./__fixtures__/upstream-contract/${name}.fixture.json`, import.meta.url),
      'utf8'
    )
  ).body;
const clone = (o) => structuredClone(o);

/** Apply `fn` to every cardview of every list of a page. */
function mapCardviews(page, fn) {
  const p = clone(page);
  for (const l of p.container.json_dict.cardlists)
    l.cardviews = l.cardviews.map((v) => fn(v, l.tag));
  return p;
}
const rename = (from, to) => (v) => {
  if (!(from in v)) return v;
  const { [from]: val, ...rest } = v;
  return { ...rest, [to]: val };
};
const drop =
  (...keys) =>
  (v) =>
    Object.fromEntries(Object.entries(v).filter(([k]) => !keys.includes(k)));
const renameList = (page, from, to) => {
  const p = clone(page);
  for (const l of p.container.json_dict.cardlists) if (l.tag === from) l.tag = to;
  return p;
};

describe('EDHREC commander page', () => {
  const page = fx('edhrec-commander-sythis');
  it('holds on the live shape and reports the theme list', () => {
    const r = checkEdhrecCommanderPage(page);
    expect(r.failures).toEqual([]);
    expect(r.notes).toContain('theme list is "highliftcards"');
  });
  it('also holds on the pre-2026-10 shape (highsynergycards, inclusion, synergy only)', () => {
    let old = renameList(page, 'highliftcards', 'highsynergycards');
    old = mapCardviews(old, (v) => drop('lift')(rename('num_decks', 'inclusion')(v)));
    const r = checkEdhrecCommanderPage(old);
    expect(r.failures).toEqual([]);
    expect(r.notes).toContain('theme list is "highsynergycards"');
  });
  it('FAILS when the deck count is renamed again (inclusion -> num_decks drift, 2026-07)', () => {
    const r = checkEdhrecCommanderPage(mapCardviews(page, rename('num_decks', 'deck_count')));
    expect(r.failures.join('\n')).toMatch(/num_decks or inclusion/);
  });
  it('FAILS when synergy and lift are both gone', () => {
    const r = checkEdhrecCommanderPage(mapCardviews(page, drop('synergy', 'lift')));
    expect(r.failures.join('\n')).toMatch(/synergy or lift/);
  });
  it('FAILS when potential_decks goes (the inclusion percentage divides by it)', () => {
    const r = checkEdhrecCommanderPage(mapCardviews(page, drop('potential_decks')));
    expect(r.failures.join('\n')).toMatch(/potential_decks/);
  });
  it('FAILS when the theme list is renamed to something we do not know (highsynergycards -> highliftcards drift)', () => {
    const r = checkEdhrecCommanderPage(renameList(page, 'highliftcards', 'highfoocards'));
    expect(r.failures.join('\n')).toMatch(/no theme list/);
  });
  it('FAILS when a type-list tag we map is renamed', () => {
    const r = checkEdhrecCommanderPage(renameList(page, 'creatures', 'creatureslist'));
    expect(r.failures.join('\n')).toMatch(/type lists missing: creatures/);
  });
  it('FAILS when cardlists vanishes or the commander deck count moves again', () => {
    expect(checkEdhrecCommanderPage({ container: { json_dict: {} } }).failures[0]).toMatch(
      /cardlists/
    );
    const p = clone(page);
    delete p.container.json_dict.card.num_decks;
    expect(checkEdhrecCommanderPage(p).failures.join('\n')).toMatch(/card\.num_decks/);
  });
  it('themeListOf ignores an empty theme list', () => {
    expect(themeListOf([{ tag: 'highliftcards', cardviews: [] }])).toBeNull();
  });
});

describe('EDHREC tag page', () => {
  const page = fx('edhrec-tag-aristocrats');
  it('holds on the live shape', () => {
    expect(checkEdhrecTagPage(page).failures).toEqual([]);
  });
  it('FAILS without topcommanders, or when synergy/lift is dropped from the card lists', () => {
    expect(checkEdhrecTagPage(renameList(page, 'topcommanders', 'x')).failures.join()).toMatch(
      /topcommanders/
    );
    expect(checkEdhrecTagPage(mapCardviews(page, drop('synergy', 'lift'))).failures.join()).toMatch(
      /synergy or lift/
    );
  });
});

describe('EDHREC salt list', () => {
  const page = fx('edhrec-salt');
  it('holds on the numeric live shape', () => {
    expect(checkEdhrecSalt(page).failures).toEqual([]);
  });
  it('FAILS on the old label-string shape (E126: salt was "Salt Score: 3.05" in label)', () => {
    const old = mapCardviews(page, (v) => ({
      ...drop('salt')(v),
      label: `Salt Score: ${v.salt.toFixed(2)}`,
    }));
    expect(checkEdhrecSalt(old).failures.join()).toMatch(/numeric salt/);
  });
  it('FAILS when salt is dropped from the cardviews, or the list is empty', () => {
    expect(checkEdhrecSalt(mapCardviews(page, drop('salt'))).failures.join()).toMatch(
      /numeric salt/
    );
    expect(
      checkEdhrecSalt({ container: { json_dict: { cardlists: [{ cardviews: [] }] } } }).failures
        .length
    ).toBe(1);
  });
});

describe('EDHREC combos and top lists', () => {
  it('combos hold, and FAIL when the combo envelope changes', () => {
    const page = fx('edhrec-combos');
    expect(checkEdhrecCombos(page).failures).toEqual([]);
    const moved = clone(page);
    for (const e of moved.container.json_dict.cardlists) {
      e.details = e.combo;
      delete e.combo;
    }
    expect(checkEdhrecCombos(moved).failures.join()).toMatch(/comboId/);
  });
  it('top cards and commanders hold, and FAIL without counts or Scryfall ids', () => {
    for (const [name, kind] of [
      ['edhrec-top-cards', 'cards'],
      ['edhrec-top-commanders', 'commanders'],
    ]) {
      const page = fx(name);
      expect(checkEdhrecTopList(page, kind).failures).toEqual([]);
      expect(
        checkEdhrecTopList(mapCardviews(page, rename('num_decks', 'n')), kind).failures.join()
      ).toMatch(/num_decks/);
      expect(checkEdhrecTopList(mapCardviews(page, drop('id')), kind).failures.join()).toMatch(
        /Scryfall id/
      );
    }
  });
});

describe('Scryfall', () => {
  it('card holds, and FAILS when a read field disappears', () => {
    const card = fx('scryfall-card-lightning-bolt');
    expect(checkScryfallCard(card).failures).toEqual([]);
    const { oracle_id, ...rest } = card;
    expect(oracle_id).toBeTruthy();
    expect(checkScryfallCard(rest).failures).toEqual(['oracle_id is missing']);
  });
  it('bulk index holds, and FAILS when the download uri field is renamed (download_uri drift)', () => {
    const idx = fx('scryfall-bulk-index');
    expect(checkScryfallBulkIndex(idx).failures).toEqual([]);
    const renamed = clone(idx);
    for (const e of renamed.data) {
      e.stream_uri = e.jsonl_download_uri;
      delete e.jsonl_download_uri;
    }
    expect(checkScryfallBulkIndex(renamed).failures.join()).toMatch(/no download uri/);
    const missing = clone(idx);
    missing.data = missing.data.filter((e) => e.type !== 'oracle_tags');
    expect(checkScryfallBulkIndex(missing).failures).toContain('no "oracle_tags" entry');
  });
  it('tagger: an otag that matches nothing fails (mana-fix rename, 2026-09)', () => {
    const ok = fx('scryfall-otag-search');
    expect(checkOtagSearch(ok, 500).failures).toEqual([]);
    // Scryfall answers a zero-match search with a 404 error object.
    expect(checkOtagSearch({ object: 'error', code: 'not_found' }, 20).failures[0]).toMatch(
      /not a list/
    );
    expect(checkOtagSearch({ ...ok, total_cards: 3 }, 20).failures[0]).toMatch(/at least 20/);
  });
  it('oracle_tags and oracle_cards records hold, and FAIL when keys move', () => {
    const rec = fx('scryfall-otag-record');
    expect(checkOtagRecord(rec).failures).toEqual([]);
    expect(checkOtagRecord({ ...rec, taggings: [{ card_id: 'x' }] }).failures[0]).toMatch(
      /oracle_id/
    );
    expect(checkOracleCardRecord({ oracle_id: 'a', name: 'b' }).failures).toEqual([]);
    expect(checkOracleCardRecord({ id: 'a', name: 'b' }).failures).toEqual([
      'oracle_id is missing',
    ]);
  });
});

describe('Commander Spellbook', () => {
  const variants = fx('spellbook-variants');
  it('holds on real variants', () => {
    expect(checkSpellbookVariants(variants).failures).toEqual([]);
  });
  it('FAILS when bracketTag or uses[].card.oracleId go', () => {
    expect(checkSpellbookVariants(variants.map(drop('bracketTag'))).failures.join()).toMatch(
      /bracketTag/
    );
    const noOracle = variants.map((v) => ({
      ...v,
      uses: v.uses.map((u) => ({ ...u, card: { name: u.card.name } })),
    }));
    expect(checkSpellbookVariants(noOracle).failures.join()).toMatch(/oracleId/);
  });
  it('firstVariants pulls whole objects out of a truncated prefix, honouring strings with braces', () => {
    const text = JSON.stringify({
      timestamp: 't',
      variants: [{ id: 'a', d: 'x } "y" {' }, { id: 'b' }, { id: 'c' }],
    });
    expect(firstVariants(text, 2).map((v) => v.id)).toEqual(['a', 'b']);
    // cut mid-third-object: only the complete ones come back
    expect(firstVariants(text.slice(0, text.length - 12), 5).map((v) => v.id)).toEqual(['a', 'b']);
    expect(firstVariants('not json', 3)).toEqual([]);
  });
});
