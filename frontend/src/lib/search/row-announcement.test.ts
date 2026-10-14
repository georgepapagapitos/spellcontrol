// @vitest-environment happy-dom
/**
 * E1008: the add-cards keyboard announcement names the row and the badges the
 * row shows. The text builder is pinned here; the guard at the bottom fails
 * when a new row badge ships without the `data-status` the announcement reads.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inDeckStatus, rowAnnouncement, rowStatuses } from './row-announcement';

describe('rowAnnouncement', () => {
  it('names the card, then the warnings, then the position, then the action', () => {
    expect(
      rowAnnouncement({
        name: 'Solemn Offering',
        statuses: ['Off-color', 'Unowned'],
        index: 1,
        total: 2,
      })
    ).toBe('Solemn Offering, Off-color, Unowned, 2 of 2. Enter adds it.');
  });

  it('says the copy count of a card already in the deck', () => {
    expect(inDeckStatus(1)).toBe('in deck, 1 copy');
    expect(inDeckStatus(3)).toBe('in deck, 3 copies');
    expect(
      rowAnnouncement({ name: 'Sol Ring', statuses: [inDeckStatus(1)], index: 0, total: 2 })
    ).toBe('Sol Ring, in deck, 1 copy, 1 of 2. Enter adds it.');
  });

  it('a row with nothing to flag is name, position, action', () => {
    expect(rowAnnouncement({ name: 'Ancient Tomb', statuses: [], index: 0, total: 9 })).toBe(
      'Ancient Tomb, 1 of 9. Enter adds it.'
    );
  });

  it('marks the end of the list when the key did not move the highlight', () => {
    expect(
      rowAnnouncement({ name: 'Sol Ring', statuses: [], index: 4, total: 5, edge: 'last' })
    ).toBe('Sol Ring, 5 of 5. Last result. Enter adds it.');
    expect(
      rowAnnouncement({ name: 'Sol Ring', statuses: [], index: 0, total: 5, edge: 'first' })
    ).toBe('Sol Ring, 1 of 5. First result. Enter adds it.');
  });

  it('does not promise an add the copy limit refuses', () => {
    expect(
      rowAnnouncement({ name: 'Sol Ring', statuses: [], index: 0, total: 2, atCopyLimit: true })
    ).toBe('Sol Ring, 1 of 2. At its copy limit.');
  });
});

describe('rowStatuses', () => {
  it('reads each badge in the row, in the row order', () => {
    const row = document.createElement('li');
    row.innerHTML =
      '<span data-status="Off-color">Off-color</span><b>x</b><span data-status="Unowned">$4</span><span>EDHREC 12%</span>';
    expect(rowStatuses(row)).toEqual(['Off-color', 'Unowned']);
    expect(rowStatuses(null)).toEqual([]);
  });
});

// Every badge that tells the user something about a row carries `data-status`.
// A new one is either marked (and so announced) or this fails with its location.
describe('guard: no row badge goes unannounced', () => {
  const root = resolve(__dirname, '../..');
  const files = ['components/deck/CardSearchPanel.tsx', 'components/deck/add-problem-segments.tsx'];
  const badgeClass = /card-search-(badge|indeck|problem)\b|className=\{badge\.className\}/g;

  for (const file of files) {
    it(file, () => {
      const src = readFileSync(resolve(root, file), 'utf8');
      const missing: string[] = [];
      for (const m of src.matchAll(badgeClass)) {
        const at = m.index ?? 0;
        // Skip the .css selector style mentions in comments and the type-only uses.
        const lineStart = src.lastIndexOf('\n', at) + 1;
        if (/^\s*(\/\/|\*|\/\*)/.test(src.slice(lineStart, src.indexOf('\n', at)))) continue;
        const tag = src.slice(src.lastIndexOf('<', at), src.indexOf('>', at));
        if (!tag.includes('data-status')) {
          missing.push(`${file}:${src.slice(0, at).split('\n').length} ${m[0]}`);
        }
      }
      expect(missing, 'badge without data-status (see lib/search/row-announcement.ts)').toEqual([]);
    });
  }
});
