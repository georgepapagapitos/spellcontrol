import { describe, expect, it } from 'vitest';
import {
  MAX_CARD_REFS,
  MAX_LINK_INPUT,
  isScryfallLink,
  parseScryfallCardRefs,
} from './scryfall-card-link';

const SOL_RING_ID = '6d5537da-112e-4ea8-9e4e-8a5ec1a8b2c4';
const OTHER_ID = '0000579f-7b35-4ed3-b44c-db2a538066fe';

describe('parseScryfallCardRefs: card pages', () => {
  it('reads set and number from a card page URL', () => {
    expect(parseScryfallCardRefs('https://scryfall.com/card/cmm/396/sol-ring')).toEqual([
      { set: 'cmm', number: '396' },
    ]);
  });

  it('accepts http, www, no slug and a trailing slash', () => {
    for (const url of [
      'http://scryfall.com/card/cmm/396',
      'https://www.scryfall.com/card/cmm/396/',
      'scryfall.com/card/cmm/396/sol-ring',
      '//scryfall.com/card/cmm/396/sol-ring',
      'https://scryfall.com/card/CMM/396/sol-ring?utm_source=x',
      'https://scryfall.com/card/cmm/396#rulings',
    ]) {
      expect(parseScryfallCardRefs(url), url).toEqual([{ set: 'cmm', number: '396' }]);
    }
  });

  it('keeps letters, dashes and stars in collector numbers', () => {
    expect(parseScryfallCardRefs('https://scryfall.com/card/sld/123a/x')).toEqual([
      { set: 'sld', number: '123a' },
    ]);
    expect(parseScryfallCardRefs('https://scryfall.com/card/ymid/A-12/a-thing')).toEqual([
      { set: 'ymid', number: 'A-12' },
    ]);
    expect(parseScryfallCardRefs('https://scryfall.com/card/plst/2XM-17/x')).toEqual([
      { set: 'plst', number: '2XM-17' },
    ]);
    expect(parseScryfallCardRefs('https://scryfall.com/card/pwar/1★/x')).toEqual([
      { set: 'pwar', number: '1★' },
    ]);
  });

  it('decodes a percent-encoded star', () => {
    expect(parseScryfallCardRefs('https://scryfall.com/card/pwar/1%E2%98%85/x')).toEqual([
      { set: 'pwar', number: '1★' },
    ]);
  });

  it('keeps a malformed percent sequence as written', () => {
    expect(parseScryfallCardRefs('https://scryfall.com/card/pwar/1%E2/x')).toEqual([
      { set: 'pwar', number: '1%E2' },
    ]);
  });

  it('reads a page with a language segment', () => {
    expect(parseScryfallCardRefs('https://scryfall.com/card/war/1/ja/karn')).toEqual([
      { set: 'war', number: '1' },
    ]);
  });

  it('rejects set codes shorter than 3 or longer than 6', () => {
    expect(parseScryfallCardRefs('https://scryfall.com/card/ab/1/x')).toEqual([]);
    expect(parseScryfallCardRefs('https://scryfall.com/card/abcdefg/1/x')).toEqual([]);
  });
});

describe('parseScryfallCardRefs: images and the API', () => {
  it('reads the printing id from a CDN image URL, with or without a query', () => {
    for (const url of [
      `https://cards.scryfall.io/normal/front/6/d/${SOL_RING_ID}.jpg?1562404432`,
      `https://cards.scryfall.io/large/back/6/d/${SOL_RING_ID}.jpg`,
      `https://cards.scryfall.io/art_crop/front/6/d/${SOL_RING_ID}.jpg?1`,
      `https://cards.scryfall.io/png/front/6/d/${SOL_RING_ID}.png?1562404432`,
      `https://c1.scryfall.com/file/scryfall-cards/normal/front/6/d/${SOL_RING_ID}.jpg`,
      `https://img.scryfall.com/cards/normal/front/6/d/${SOL_RING_ID}.jpg`,
    ]) {
      expect(parseScryfallCardRefs(url), url).toEqual([{ id: SOL_RING_ID }]);
    }
  });

  it('lowercases an uppercase id', () => {
    expect(
      parseScryfallCardRefs(`https://api.scryfall.com/cards/${SOL_RING_ID.toUpperCase()}`)
    ).toEqual([{ id: SOL_RING_ID }]);
  });

  it('reads API id and set/number URLs', () => {
    expect(parseScryfallCardRefs(`https://api.scryfall.com/cards/${SOL_RING_ID}`)).toEqual([
      { id: SOL_RING_ID },
    ]);
    expect(parseScryfallCardRefs('https://api.scryfall.com/cards/cmm/396')).toEqual([
      { set: 'cmm', number: '396' },
    ]);
    expect(parseScryfallCardRefs('https://api.scryfall.com/cards/cmm/396?format=json')).toEqual([
      { set: 'cmm', number: '396' },
    ]);
  });

  it('does not read other API endpoints as a set', () => {
    expect(parseScryfallCardRefs('https://api.scryfall.com/cards/mtgo/54957')).toEqual([]);
    expect(parseScryfallCardRefs('https://api.scryfall.com/cards/arena/67330')).toEqual([]);
    expect(parseScryfallCardRefs('https://api.scryfall.com/cards/named?exact=sol+ring')).toEqual(
      []
    );
    expect(parseScryfallCardRefs('https://api.scryfall.com/cards/search?q=sol')).toEqual([]);
  });
});

describe('parseScryfallCardRefs: dropped HTML', () => {
  it('prefers the image id over the page link of the same dragged card', () => {
    const uriList = 'https://scryfall.com/card/cmm/396/sol-ring';
    const html =
      '<a href="https://scryfall.com/card/cmm/396/sol-ring" class="card-grid-item-card">' +
      `<img class="card" src="https://cards.scryfall.io/normal/front/6/d/${SOL_RING_ID}.jpg?1562404432" alt="Sol Ring"></a>`;
    expect(parseScryfallCardRefs(`${uriList}\n${html}`)).toEqual([{ id: SOL_RING_ID }]);
  });

  it('reads every card of a dragged selection, in order, once each', () => {
    const html =
      `<a href="https://scryfall.com/card/cmm/396/sol-ring"><img src="https://cards.scryfall.io/normal/front/6/d/${SOL_RING_ID}.jpg?1"></a>` +
      `<a href="https://scryfall.com/card/lea/1/x"><img src="https://cards.scryfall.io/normal/front/0/0/${OTHER_ID}.jpg?2"></a>` +
      `<img src="https://cards.scryfall.io/small/front/6/d/${SOL_RING_ID}.jpg?1">`;
    expect(parseScryfallCardRefs(html)).toEqual([{ id: SOL_RING_ID }, { id: OTHER_ID }]);
  });

  it('reads page links out of a text-only fragment', () => {
    const html =
      "<p><a href='https://scryfall.com/card/cmm/396/sol-ring'>Sol Ring</a> and " +
      '<a href="https://scryfall.com/card/lea/232/black-lotus">Black Lotus</a> and ' +
      '<a href="https://scryfall.com/card/cmm/396/sol-ring">again</a></p>';
    expect(parseScryfallCardRefs(html)).toEqual([
      { set: 'cmm', number: '396' },
      { set: 'lea', number: '232' },
    ]);
  });

  it('caps the number of cards', () => {
    const many = Array.from(
      { length: MAX_CARD_REFS + 10 },
      (_, i) => `https://scryfall.com/card/sld/${i + 1}/x`
    ).join('\n');
    expect(parseScryfallCardRefs(many)).toHaveLength(MAX_CARD_REFS);
  });
});

describe('parseScryfallCardRefs: not a card', () => {
  it('gives nothing for non-Scryfall or non-card input', () => {
    for (const text of [
      '',
      'sol ring',
      'https://moxfield.com/decks/abc',
      'https://notscryfall.com/card/cmm/396/sol-ring',
      'https://scryfall.com/search?q=sol+ring',
      'https://scryfall.com/sets/cmm',
      'https://scryfall.com/card/cmm',
      'https://cards.scryfall.io/normal/front/6/d/not-a-uuid.jpg',
      'https://example.com/?u=https%3A%2F%2Fscryfall.com%2Fcard%2Fcmm%2F396',
    ]) {
      expect(parseScryfallCardRefs(text), text).toEqual([]);
    }
  });

  it('only scans the first MAX_LINK_INPUT characters', () => {
    const text = `${'x'.repeat(MAX_LINK_INPUT)} https://scryfall.com/card/cmm/396/sol-ring`;
    expect(parseScryfallCardRefs(text)).toEqual([]);
  });

  it('stays fast on a hostile, near-matching input', () => {
    const hostile = `https://scryfall.com/card/abc/${'%2'.repeat(20_000)}`;
    const t0 = performance.now();
    parseScryfallCardRefs(hostile);
    parseScryfallCardRefs('scryfall.com/card/'.repeat(3_000));
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe('isScryfallLink', () => {
  it('is true for any single Scryfall URL', () => {
    expect(isScryfallLink('https://scryfall.com/card/cmm/396/sol-ring')).toBe(true);
    expect(isScryfallLink('  https://scryfall.com/search?q=sol  ')).toBe(true);
    expect(isScryfallLink('scryfall.com')).toBe(true);
    expect(isScryfallLink('https://www.scryfall.com/sets')).toBe(true);
    expect(isScryfallLink(`https://cards.scryfall.io/normal/front/6/d/${SOL_RING_ID}.jpg`)).toBe(
      true
    );
  });

  it('is false for queries and other sites', () => {
    expect(isScryfallLink('sol ring')).toBe(false);
    expect(isScryfallLink('o:scryfall.com')).toBe(false);
    expect(isScryfallLink('https://scryfall.community')).toBe(false);
    expect(isScryfallLink('https://moxfield.com/decks/abc')).toBe(false);
    expect(isScryfallLink('https://scryfall.com/card/cmm/396 sol ring')).toBe(false);
    expect(isScryfallLink(`https://scryfall.com/${'a'.repeat(3000)}`)).toBe(false);
  });
});
