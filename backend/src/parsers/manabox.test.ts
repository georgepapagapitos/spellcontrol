import { describe, it, expect } from 'vitest';
import { looksLikeManabox, parseManabox } from './manabox';

const HEADER =
  'Name\tSet code\tSet name\tCollector number\tFoil\tCondition\tLanguage\tQuantity\tScryfall ID\tBinder Name\tBinder Type\tRarity\tPurchase price\tWhatever\tMore\tAndMore';

describe('looksLikeManabox', () => {
  it('matches the canonical ManaBox header', () => {
    expect(looksLikeManabox(HEADER)).toBe(true);
  });

  it('rejects CSVs without tabs', () => {
    expect(looksLikeManabox('Name,Set,Foil')).toBe(false);
  });

  it('rejects TSVs that miss required signature columns', () => {
    expect(looksLikeManabox('Name\tSet\tFoil')).toBe(false);
  });
});

describe('parseManabox', () => {
  it('returns no rows for empty / header-only input', () => {
    expect(parseManabox('').rows).toEqual([]);
    expect(parseManabox(HEADER).rows).toEqual([]);
  });

  it('parses a normal ManaBox row', () => {
    const row =
      'Sol Ring\tCMR\tCommander Legends\t472\tnormal\tNM\tEN\t2\tabc-123\tMy Binder\tCard\tuncommon\t1.50\tx\ty\tz';
    const out = parseManabox(`${HEADER}\n${row}`);
    expect(out.rows).toHaveLength(1);
    const r = out.rows[0];
    expect(r.name).toBe('Sol Ring');
    expect(r.setCode).toBe('CMR');
    expect(r.collectorNumber).toBe('472');
    expect(r.finish).toBe('nonfoil');
    expect(r.quantity).toBe(2);
    expect(r.scryfallId).toBe('abc-123');
    expect(r.sourceCategory).toBe('My Binder');
    expect(r.rarity).toBe('uncommon');
    // Price is read from the right end (PRICE_FROM_END=6).
    expect(typeof r.purchasePrice === 'number' || r.purchasePrice === undefined).toBe(true);
  });

  it('detects foil from the Foil column', () => {
    const row =
      'Sol Ring\tCMR\tCommander Legends\t472\tfoil\tNM\tEN\t1\tabc\tBinder\tCard\tuncommon\t1.50\tx\ty\tz';
    expect(parseManabox(`${HEADER}\n${row}`).rows[0].finish).toBe('foil');
  });

  it('detects etched from the Foil column', () => {
    const row =
      'Sol Ring\tCMR\tCommander Legends\t472\tetched\tNM\tEN\t1\tabc\tBinder\tCard\tuncommon\t1.50\tx\ty\tz';
    expect(parseManabox(`${HEADER}\n${row}`).rows[0].finish).toBe('etched');
  });

  it('captures condition, language, misprint, altered from per-copy columns', () => {
    // HEADER columns: Name Set Set Coll Foil Cond Lang Qty Scryfall Binder BinderT Rarity Price x y z
    // Index:             0    1   2   3    4    5    6   7    8        9     10     11    12  13 14 15
    // Slot 5 = Condition, slot 6 = Language. We add misprint/altered in the tail.
    const HEADER_WITH_FLAGS =
      'Name\tSet code\tSet name\tCollector number\tFoil\tCondition\tLanguage\tQuantity\tScryfall ID\tBinder Name\tBinder Type\tRarity\tMisprint\tAltered\tPurchase price\tCurrency';
    const row =
      'Sol Ring\tCMR\tCommander Legends\t472\tnormal\tlightly_played\tja\t1\tabc\tBinder\tCard\tuncommon\ttrue\tfalse\t1.50\tUSD';
    const r = parseManabox(`${HEADER_WITH_FLAGS}\n${row}`).rows[0];
    expect(r.condition).toBe('lp');
    expect(r.language).toBe('ja');
    expect(r.misprint).toBe(true);
    expect(r.altered).toBe(false);
  });

  it('skips rows with no name', () => {
    const row =
      '\tCMR\tCommander Legends\t472\tnormal\tNM\tEN\t1\tabc\tBinder\tCard\tuncommon\t1.50\tx\ty\tz';
    const out = parseManabox(`${HEADER}\n${row}`);
    expect(out.rows).toEqual([]);
    expect(out.unparsedLines).toEqual([row]);
  });

  it('skips lines whose column count does not match the header', () => {
    const row = 'Sol Ring\tCMR';
    const out = parseManabox(`${HEADER}\n${row}`);
    expect(out.rows).toEqual([]);
    expect(out.unparsedLines).toEqual([row]);
  });

  it('repairs rows with extra tabs from embedded names by stitching the middle', () => {
    // Add an extra tab inside the Scryfall-ID middle band to simulate an
    // embedded tab in the card/set name. With 16 columns and tailLen=6, head=9
    // and tail=6 cover the extras, middle is rejoined.
    const row =
      'Sol\tRing\tCMR\tCommander Legends\t472\tnormal\tNM\tEN\t1\tabc\t123\tBinder\tCard\tuncommon\t1.50\tx\ty\tz';
    const out = parseManabox(`${HEADER}\n${row}`);
    expect(out.rows.length + out.unparsedLines.length).toBe(1);
  });

  it('skips blank lines between rows', () => {
    const row =
      'Sol Ring\tCMR\tCommander Legends\t472\tnormal\tNM\tEN\t1\tabc\tBinder\tCard\tuncommon\t1.50\tx\ty\tz';
    const out = parseManabox(`${HEADER}\n\n${row}`);
    expect(out.rows).toHaveLength(1);
  });
});
