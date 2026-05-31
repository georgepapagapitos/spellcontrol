import { describe, expect, it } from 'vitest';
import {
  collapsedSectionsFor,
  type CardPreviewSection,
  type CardPreviewSource,
} from './card-preview-sections';

// Locks the per-surface collapsed-curation policy (the contract that replaced
// the old one-size-fits-all CSS `display:none` block). Each surface must show a
// deliberate, complete collapsed snapshot of *its* essentials; expanding always
// reveals the rest. The card name is rendered unconditionally (not part of this
// list), so it never appears here.
describe('collapsedSectionsFor — per-surface collapsed policy', () => {
  const cases: Array<[CardPreviewSource, CardPreviewSection[]]> = [
    // Deck: the rich contextual meta block (partner/role/inclusion/legality) + price.
    ['deck', ['panelMeta', 'meta']],
    // Collection: set/printing, finish+price+qty, and binder/deck membership.
    ['collection', ['context', 'meta', 'set']],
    // Binder: membership + page position + price.
    ['binder', ['context', 'meta', 'counter']],
    // Suggestion drill-downs: why the card surfaced (the label) + role + price.
    ['suggestion', ['context', 'meta', 'role']],
    // Search: price + the inline printing/finish picker (the surface's action).
    ['search', ['meta', 'panelExtra']],
    // Playtest goldfishing: just price (plus the always-on name + image).
    ['playtest', ['meta']],
  ];

  it.each(cases)('source "%s" keeps %j collapsed', (source, expected) => {
    expect(collapsedSectionsFor(source)).toEqual(expected);
  });

  it('falls back to the generic default when no source is given', () => {
    // Mirrors the pre-curation behavior so an un-migrated call site never regresses.
    expect(collapsedSectionsFor()).toEqual(['panelMeta', 'meta', 'role', 'panelExtra']);
  });

  it('lets an explicit collapsedSections override win over the source policy', () => {
    expect(collapsedSectionsFor('deck', ['set'])).toEqual(['set']);
  });

  it('honors an empty override (name + image only)', () => {
    expect(collapsedSectionsFor('collection', [])).toEqual([]);
  });
});
