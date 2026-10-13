import { describe, expect, it } from 'vitest';
import type { BinderPage, EnrichedCard } from '@/types/index';
import { binderCopyHref, findCopyPage } from './locate-copy';

const copy = (copyId: string, scryfallId: string, finish = 'nonfoil') =>
  ({ copyId, scryfallId, finish, foil: finish !== 'nonfoil' }) as EnrichedCard;

const pages: BinderPage[] = [
  { pageNum: 1, slots: [copy('a1', 'bolt'), null, copy('a2', 'bolt', 'foil')] },
  { pageNum: 2, slots: [null, copy('a3', 'bolt', 'etched'), copy('a4', 'bolt')] },
];

describe('binderCopyHref', () => {
  it('opens the binder with the copy in the query', () => {
    expect(binderCopyHref('b1', 'c 1/x')).toBe('/collection/binders/b1?copy=c%201%2Fx');
  });
});

describe('findCopyPage', () => {
  it('finds the copy itself, with its page and pocket', () => {
    expect(findCopyPage(pages, 'a4')).toEqual({ pageIndex: 1, copyId: 'a4', slot: 3 });
  });

  it('falls back to the same printing and finish when grouping kept another copy', () => {
    expect(findCopyPage(pages, 'gone', copy('gone', 'bolt', 'etched'))).toEqual({
      pageIndex: 1,
      copyId: 'a3',
      slot: 2,
    });
  });

  it('prefers the copy itself over an earlier copy of its printing', () => {
    expect(findCopyPage(pages, 'a4', copy('a4', 'bolt'))?.copyId).toBe('a4');
  });

  it('finds nothing for a copy and printing the binder does not hold', () => {
    expect(findCopyPage(pages, 'gone', copy('gone', 'sol-ring'))).toBeNull();
    expect(findCopyPage(pages, 'gone')).toBeNull();
  });
});
