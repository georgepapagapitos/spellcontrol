import { describe, it, expect } from 'vitest';
import { preconNames, readPreconStamp, releaseDateMs } from './precon-deck';

describe('releaseDateMs', () => {
  it('reads a MTGJSON date as UTC midnight', () => {
    expect(releaseDateMs('2011-06-17')).toBe(Date.UTC(2011, 5, 17));
  });

  it('is null for an absent or malformed date', () => {
    expect(releaseDateMs('')).toBeNull();
    expect(releaseDateMs('2011-6-17')).toBeNull();
    expect(releaseDateMs('2011-13-45')).toBeNull();
  });
});

describe('readPreconStamp', () => {
  it('reads the stamp off a stored precon', () => {
    expect(
      readPreconStamp({
        precon: { fileName: 'F', code: 'C', releaseDate: '2020-01-01', refreshedAt: 5 },
      })
    ).toEqual({ fileName: 'F', code: 'C', releaseDate: '2020-01-01', refreshedAt: 5 });
  });

  it('tolerates missing optional fields', () => {
    expect(readPreconStamp({ precon: { fileName: 'F', refreshedAt: 5 } })).toEqual({
      fileName: 'F',
      code: '',
      releaseDate: '',
      refreshedAt: 5,
    });
  });

  it('is null for a deck that is not a precon', () => {
    expect(readPreconStamp(null)).toBeNull();
    expect(readPreconStamp({ name: 'A deck' })).toBeNull();
    expect(readPreconStamp({ precon: { fileName: 'F' } })).toBeNull();
  });
});

describe('preconNames', () => {
  const product = (fileName: string, name: string, releaseDate: string) => ({
    fileName,
    name,
    releaseDate,
    code: '',
    type: 'Commander Deck',
  });

  it('adds the year only to a name Wizards printed more than once', () => {
    const names = preconNames([
      product('A_CMD', 'Heavenly Inferno', '2011-06-17'),
      product('A_CM1', 'Heavenly Inferno', '2017-06-09'),
      product('B_C16', 'Breed Lethality', '2016-11-11'),
    ]);
    expect([...names.values()]).toEqual([
      'Heavenly Inferno (2011)',
      'Heavenly Inferno (2017)',
      'Breed Lethality',
    ]);
  });
});
