// @vitest-environment node
//
// Guard: a name given to an element that cannot carry one, and a `li` whose
// role is not listitem.
//
// axe `aria-prohibited-attr`: `aria-label` on a bare `span`/`div`/`i`/`p` (no
// role) is ignored by assistive tech, so the status/colour/loading text it was
// meant to convey never reaches a screen reader. `role="presentation"`/"none"
// plus `aria-label` contradicts itself. axe `list`: a `ul`/`ol` may only hold
// `li`s, and an `li` given `role="button"`/"status"/... stops being one.
//
// Fix: give the element a real role (`role="img"` for a glyph group, or
// `role="group"`/`"region"` for a container), or replace the label with
// visually-hidden text; put a live region / interactive role on an element
// INSIDE the `li`, never on the `li`.
//
// jsx-a11y has no rule for the first case, so this walks the tree.

import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { parseTsx, sourceFiles, strings } from './jsx-scan';

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GENERIC = new Set(['span', 'div', 'i', 'p', 'b', 'em', 'strong', 'small']);

function attrs(node: ts.JsxOpeningLikeElement) {
  const found = new Map<string, ts.JsxAttribute>();
  for (const a of node.attributes.properties)
    if (ts.isJsxAttribute(a)) found.set(a.name.getText(), a);
  return found;
}

const roleOf = (a?: ts.JsxAttribute): string[] =>
  a?.initializer ? strings(a.initializer).flatMap((s) => s.trim().split(/\s+/)) : [];

/** The enclosing JSX element's opening tag, or undefined at a fragment/root. */
function parentTag(node: ts.Node): ts.JsxOpeningElement | undefined {
  for (let p = node.parent?.parent; p; p = p.parent)
    if (ts.isJsxElement(p)) return p.openingElement;
  return undefined;
}

describe('aria-label needs an element that can be named', () => {
  it('no bare span/div/i/p with aria-label, no li with a non-listitem role', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(srcDir)) {
      const sf = parseTsx(file);
      const visit = (node: ts.Node) => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          const tag = node.tagName.getText();
          const a = attrs(node);
          const roles = roleOf(a.get('role'));
          const where = () =>
            `${file.slice(srcDir.length + 1)}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1} <${tag}>`;
          if (
            GENERIC.has(tag) &&
            a.has('aria-label') &&
            // A dynamic `role={...}` is trusted; only a missing or literal
            // presentation/none role is a defect.
            // aria-hidden: pointer-only overlays (life tap zones) are out of the
            // accessibility tree, so the label is inert and harmless.
            !a.has('aria-hidden') &&
            (!a.has('role') || roles[0] === 'presentation' || roles[0] === 'none')
          )
            offenders.push(`${where()} has aria-label but no naming role`);
          // An li under a role-less ul/ol must stay a listitem; under
          // role=listbox/menu/tablist the ul is not a list, so option/menuitem are right.
          const parent = parentTag(node);
          if (
            tag === 'li' &&
            roles.length > 0 &&
            roles[0] !== 'listitem' &&
            parent &&
            ['ul', 'ol'].includes(parent.tagName.getText()) &&
            !attrs(parent as unknown as ts.JsxOpeningLikeElement).has('role')
          )
            offenders.push(`${where()} has role="${roles[0]}" (breaks the list)`);
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    expect(
      offenders,
      'aria-label is ignored on a role-less span/div/i/p, and a role on an li ' +
        'breaks its list. Use role="img"/"group"/"region" with the label, or ' +
        'visually-hidden text; move roles inside the li.\n  ' +
        offenders.join('\n  ')
    ).toEqual([]);
  });
});
