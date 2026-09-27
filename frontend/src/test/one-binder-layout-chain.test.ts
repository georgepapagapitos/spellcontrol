// @vitest-environment node
//
// Guard: every answer to "where is this card?" is laid out from one chain,
// `useBinderLayoutInputs()` (lib/use-binder-layout-inputs.ts), the inputs
// BinderPage renders from.
//
// A card's binder, page and pocket depend on more than the raw collection:
// oracle tags decide tag rules, Secret Lair drops and per-printing release
// dates decide Set and Release-date sections, deck allocations decide what a
// "hide deck cards" binder skips, and the set map dates every set. Before this
// guard six surfaces each re-derived their own subset of that chain (tags
// only, or nothing at all), so a binder sorted by release date reported one
// page on the binder, another in the deck pull list, trades and combos, and
// Home's "cards to file" could disagree with the index's "N to review".
//
// Two checks, each with a reasoned allowlist:
//   1. `bindersUseTags(` / `bindersUseSldDrops(` / `bindersUseReleaseDates(`
//      (the gates of the decoration chain) appear only in the chain itself. A
//      surface that needs decorated cards reads `useBinderLayoutInputs()`.
//   2. `materializeBinders(` is called only from files that get their inputs
//      from that chain, or from a pure helper whose callers do.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = resolve(fileURLToPath(import.meta.url), '..', '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const rel = (file: string) => relative(srcDir, file).split(sep).join('/');

const CHAIN_GATE = /\bbindersUse(Tags|SldDrops|ReleaseDates)\s*\(/;
const MATERIALIZE = /\bmaterializeBinders\s*\(/;

/** Files allowed to call a chain gate, each with its reason. */
const GATE_ALLOWLIST: Record<string, string> = {
  'lib/use-binder-layout-inputs.ts': 'the chain itself',
  'lib/card-tags.ts': 'defines bindersUseTags',
  'lib/sld-drops.ts': 'defines bindersUseSldDrops',
  'lib/card-release-dates.ts': 'defines bindersUseReleaseDates',
  'store/collection.ts':
    "the store's price-refresh move notice runs outside React and cannot call a hook",
  'components/ScannerQueueSheet.tsx':
    'decorates the pending Add list rows, not the collection, to predict their binder',
};

/** Files allowed to call materializeBinders, each with where its inputs come from. */
const MATERIALIZE_ALLOWLIST: Record<string, string> = {
  'lib/materialize.ts': 'defines the memoized materializeBinders',
  'lib/card-locations.ts': 'takes BinderLayoutInputs whole',
  'lib/import-routing.ts': 'takes BinderLayoutInputs whole',
  'lib/use-binder-by-copy.ts': 'its hook reads useBinderLayoutInputs',
  'lib/ownership-lens.ts': 'fed by use-ownership-lens, which reads useBinderLayoutInputs',
  'lib/pull-list.ts': 'fed by DeckEditorPage and DecksIndexPage from useBinderLayoutInputs',
  'lib/cube/pull-list.ts': 'fed by CubePullList from useBinderLayoutInputs',
  'lib/binder-moves.ts': "the store's price-refresh move notice, outside React",
  'lib/binder-counts.ts': "the rules editor's draft counts, which route a binder not yet saved",
  'pages/BinderPage.tsx': 'reads useBinderLayoutInputs',
  'pages/BindersIndexPage.tsx': 'reads useBinderLayoutInputs',
  'pages/CollectionPage.tsx': 'reads useBinderLayoutInputs',
  'components/home/use-binder-review-count.ts': 'reads useBinderLayoutInputs',
};

function check(pattern: RegExp, allowlist: Record<string, string>) {
  const files = sourceFiles(srcDir);
  const offenders = files
    .map(rel)
    .filter((path) => !(path in allowlist))
    .filter((path) => pattern.test(readFileSync(join(srcDir, ...path.split('/')), 'utf8')));
  const stale = Object.keys(allowlist).filter((path) => {
    try {
      return !pattern.test(readFileSync(join(srcDir, ...path.split('/')), 'utf8'));
    } catch {
      return true;
    }
  });
  return { files, offenders, stale };
}

describe('one binder layout chain', () => {
  it('only the chain decorates the collection for binders', () => {
    const { offenders } = check(CHAIN_GATE, GATE_ALLOWLIST);
    expect(
      offenders,
      'These re-derive part of the binder decoration chain. Read ' +
        'useBinderLayoutInputs() (lib/use-binder-layout-inputs.ts) instead, so the ' +
        'binder, page and pocket they report match the binder view:\n  ' +
        offenders.join('\n  ')
    ).toEqual([]);
  });

  it('only chain-fed files lay binders out', () => {
    const { offenders } = check(MATERIALIZE, MATERIALIZE_ALLOWLIST);
    expect(
      offenders,
      'These call materializeBinders outside the chain. For a location use ' +
        'useCardLocations() (lib/card-locations.ts); otherwise read ' +
        'useBinderLayoutInputs() and add a commented allowlist entry:\n  ' +
        offenders.join('\n  ')
    ).toEqual([]);
  });

  it('the allowlists have no stale entries', () => {
    const stale = [
      ...check(CHAIN_GATE, GATE_ALLOWLIST).stale,
      ...check(MATERIALIZE, MATERIALIZE_ALLOWLIST).stale,
    ];
    expect(stale, 'These no longer match (or no longer exist); remove the entry.').toEqual([]);
  });

  it('the scan sees the codebase (guards the guard)', () => {
    expect(check(MATERIALIZE, MATERIALIZE_ALLOWLIST).files.length).toBeGreaterThan(200);
  });
});
