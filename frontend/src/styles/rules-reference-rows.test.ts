/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ref = readFileSync(join(here, '..', 'components', 'RulesReference.css'), 'utf8');
const page = readFileSync(join(here, '..', 'pages', 'RulesPage.css'), 'utf8');
const tsx = readFileSync(join(here, '..', 'components', 'RulesReference.tsx'), 'utf8');

/**
 * The Comprehensive Rules reference is a dictionary, and its two lists have to
 * read as one. Keywords shipped as bordered cards while the Glossary next door
 * was a hairline list, and at desktop width the cards' 2-up grid carried
 * `align-items: start`, so each entry kept its own content height: the shorter
 * of every pair left a ragged hole beneath it and no two row gaps measured the
 * same. A box edge is what makes that visible, which is why the Glossary never
 * looked broken doing the same thing.
 *
 * Two contracts, both of which regressed once:
 *
 * 1. Neither list draws a box, and at 2-up neither opts out of row stretching.
 *    Shared row heights are what put the two columns' hairlines on one line.
 * 2. The row menu takes its row's own vertical centering. A blanket
 *    `align-self: flex-start` on `.rules-ref-entry-menu` pinned the ⋮ to the
 *    top of its box, so it floated in the corner ABOVE the term while the rule
 *    number — which lives inside the head button — sat correctly on the line.
 *    A numbered rule is the one genuine exception: it is a paragraph, so its ⋮
 *    tracks the first line beside the number instead of centering down four
 *    lines of prose.
 */
describe('rules reference reads as one dictionary', () => {
  const block = (css: string, selector: string) =>
    new RegExp(`${selector.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(
      css
    )?.[1];

  it('a keyword entry is a hairline row, never a box', () => {
    const body = block(ref, '.rules-ref-keyword');
    expect(body).toBeTruthy();
    // `border-bottom` is the hairline; a full `border:` shorthand is the box.
    expect(body).not.toMatch(/(^|[;{\s])border:\s/);
    expect(body).toMatch(/border-bottom:/);
  });

  it('keyword and glossary entries stretch together at 2-up so hairlines align', () => {
    for (const list of ['.rules-page .rules-ref-list', '.rules-page .rules-ref-glossary']) {
      const body = block(page, list);
      expect(body, `${list} should define the 2-up grid`).toBeTruthy();
      expect(body).toMatch(/grid-template-columns/);
      // `align-items: start` (or `flex-start`) is precisely the raggedness.
      expect(body, `${list} must not opt out of row stretching`).not.toMatch(/align-items:/);
      // A row gap — named, or via the `gap` shorthand's second value —
      // reintroduces the uneven vertical spacing the hairlines replace.
      // `column-gap` is the one that belongs here.
      expect(body, `${list} separates columns only`).not.toMatch(/(^|[;{\s])(row-)?gap:/);
    }
  });

  it('the row menu is not pinned to the top of every row', () => {
    const body = block(ref, '.rules-ref-entry-menu');
    expect(body).toBeTruthy();
    expect(body).not.toMatch(/align-self:/);
  });

  it('only a numbered rule, which is a paragraph, aligns its menu to the first line', () => {
    const scoped = block(ref, '.rules-ref-rule > .rules-ref-entry-menu');
    expect(scoped).toBeTruthy();
    expect(scoped).toMatch(/align-self:\s*flex-start/);
  });

  it('the head row and the glossary term center their line, so the ⋮ sits on it', () => {
    for (const selector of ['.rules-ref-keyword-row', '.rules-ref-glossary-term']) {
      expect(block(ref, selector), selector).toMatch(/align-items:\s*center/);
    }
  });

  it('the disclosure chevron actually turns when the row opens', () => {
    // A chevron that never moves is decoration, not state. (Matched directly:
    // `block()` keys on a plain class, and this selector carries an attribute.)
    expect(ref).toMatch(
      /\.rules-ref-keyword-chevron\[data-open='true'\]\s*\{[^}]*rotate\(180deg\)/
    );
    // …and it must not animate for someone who asked it not to.
    expect(ref).toMatch(/prefers-reduced-motion/);
  });

  it('the chevron LEADS the row, as every in-place disclosure in the app does', () => {
    // Outside design systems default an accordion chevron to the end (Carbon,
    // so the title aligns with other type; NN/g only ever tested that side),
    // so this is the rule most likely to be "corrected" by someone reading
    // Carbon rather than this repo. CardRulings, CardDetails, WhyBreakdown and
    // both CoachFeed toggles all lead; a keyword opening into its numbered
    // subrules is the tree-like content Carbon itself carves out.
    const head = /className="rules-ref-keyword-head"[\s\S]*?<\/button>/.exec(tsx)?.[0];
    expect(head).toBeTruthy();
    const chevron = head!.indexOf('rules-ref-keyword-chevron');
    const name = head!.indexOf('rules-ref-keyword-name');
    expect(chevron).toBeGreaterThan(-1);
    expect(name).toBeGreaterThan(-1);
    expect(chevron, 'the chevron must precede the term').toBeLessThan(name);
  });

  it('the definition hangs under the term, not under the chevron', () => {
    // A leading chevron only reads well if the body copy clears it.
    for (const selector of ['.rules-ref-keyword-summary', '.rules-ref-keyword-body']) {
      expect(block(ref, selector), selector).toMatch(/--rules-kw-indent/);
    }
    expect(block(ref, '.rules-ref-keyword')).toMatch(/--rules-kw-indent:/);
  });

  it('the category badge is a label, not another bordered pill', () => {
    const body = block(ref, '.rules-ref-badge');
    expect(body).toBeTruthy();
    expect(body).not.toMatch(/border/);
  });
});
