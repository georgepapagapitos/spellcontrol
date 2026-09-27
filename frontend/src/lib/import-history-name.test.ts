import { describe, expect, it } from 'vitest';
import { prettyImportName } from './import-history-name';

describe('prettyImportName', () => {
  // Import history listed a precon as "product-import:Calling All Angels".
  it('names a sealed product by the product', () => {
    expect(prettyImportName('product-import:Calling All Angels', '')).toBe('Calling All Angels');
  });

  it('keeps the other internal labels friendly and passes a filename through', () => {
    expect(prettyImportName('scanned-cards', '')).toBe('Scanned cards');
    expect(prettyImportName('pasted-list', 'mtga')).toBe('Pasted MTGA list');
    expect(prettyImportName('ManaBox_Collection.csv', 'manabox')).toBe('ManaBox_Collection.csv');
  });
});
