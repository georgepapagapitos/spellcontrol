// @vitest-environment node
/**
 * Guard: every component exported from `components/shared/` is either rendered
 * in the component catalog (`pages/CatalogPage.tsx` + `pages/catalog/`) or on
 * the SKIPPED list below with the reason it cannot be.
 *
 * The catalog is what the nightly visual diff photographs
 * (`scripts/catalog-shots.mjs`), so a primitive that is not in it can change
 * pixels with nothing watching. A new shared component therefore adds a
 * catalog specimen in the same PR (STYLE_GUIDE § Component catalog). Adding it
 * to SKIPPED is the exception and needs a reason a reviewer would accept;
 * the list is a shrink-only ratchet, like the repo's other baselines.
 *
 * Fix a failure by adding `<Name …/>` to a section in
 * `pages/catalog/CatalogSections.tsx`, never by widening SKIPPED.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sharedDir = join(src, 'components/shared');

/** Shrink-only. Each entry: why it cannot stand alone in a static crop. */
const SKIPPED: Record<string, string> = {
  CardTableFrame: 'table scaffold; exercised through CardRow with `columns` in real lists',
  CardTableHead: 'table scaffold; needs a sort model and a frame around it',
  GridCaptionList: 'the caption-prefs list, only ever shown inside a popover',
  CtxMenuShell: 'a portal anchored to a pointer position; nothing to crop',
  DeckExportDialog: 'a modal; its shell is the Modal primitive, not a shared look',
  FilterTrigger: 'the trigger half of a ToolbarPopover, meaningless without the popover',
  FoilShimmer: 'painted by CardGridCell on a foil card, which the catalog renders',
  InlineRename: 'an input-swap state machine that grabs focus on mount',
  SealBurst: 'a one-shot animation; a still frame is not a stable crop',
  ShareQrCode: 'draws a QR code through a lazily loaded library',
  ToolbarPopover: 'a portal anchored to its trigger; nothing to crop when closed',
  ViewPopoverPanel: 'panel content of a ToolbarPopover, only ever shown inside one',
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const full = join(dir, e);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const exported = new Set<string>();
for (const file of readdirSync(sharedDir)) {
  if (!file.endsWith('.tsx') || /\.test\.tsx$/.test(file)) continue;
  const text = readFileSync(join(sharedDir, file), 'utf8');
  for (const m of text.matchAll(/^export function ([A-Z]\w*)/gm)) exported.add(m[1]);
}

const catalogSource = [join(src, 'pages/CatalogPage.tsx'), ...walk(join(src, 'pages/catalog'))]
  .filter((f) => /\.tsx$/.test(f))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');
const rendered = (name: string) => new RegExp('<' + name + '[\\s>/]').test(catalogSource);

describe('component catalog covers components/shared', () => {
  it('renders every exported shared component or skips it with a reason', () => {
    const missing = [...exported].filter((n) => !rendered(n) && !(n in SKIPPED)).sort();
    expect(
      missing,
      `Add a specimen for each to pages/catalog/CatalogSections.tsx: ${missing.join(', ')}`
    ).toEqual([]);
  });

  it('keeps SKIPPED honest: no entry is rendered, none is gone from shared/', () => {
    const stale = Object.keys(SKIPPED).filter((n) => rendered(n) || !exported.has(n));
    expect(stale, `Remove from SKIPPED: ${stale.join(', ')}`).toEqual([]);
  });

  it('gives every skip a reason', () => {
    for (const [name, why] of Object.entries(SKIPPED)) {
      expect(why.length, name).toBeGreaterThan(10);
    }
  });
});
