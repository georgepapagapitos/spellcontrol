/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// UX-105 guard: the spacing language is a fixed 4px-base scale defined once in
// tokens.css (see STYLE_GUIDE.md § Color & spacing). New code spaces with
// `var(--space-N)` instead of freehand rems; this test fails loudly if a scale
// step's definition goes missing.
//
// CSS `?raw` imports come back empty under this vite/rolldown setup, so read
// the stylesheet off disk (tests run in the node env per vitest.config.ts).
const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const spacingProperties =
  /^(?:margin|padding)(?:-(?:top|right|bottom|left|block|block-start|block-end|inline|inline-start|inline-end))?$|^(?:gap|row-gap|column-gap)$|^inset(?:-(?:top|right|bottom|left|block|block-start|block-end|inline|inline-start|inline-end))?$|^(?:top|right|bottom|left)$/;
const spacingLiteral = /(?<![\w.-])([0-9]*\.?[0-9]+)(px|rem)(?![\w-])/g;

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...cssFiles(full));
    else if (entry.name.endsWith('.css')) out.push(full);
  }
  return out;
}

function spaceTokenSteps(tokensCss: string): Map<string, string> {
  const steps = new Map<string, string>();
  const tokenDefinition = /(--space-\d+)\s*:\s*([0-9.]+)rem\s*;/g;
  for (const match of tokensCss.matchAll(tokenDefinition)) {
    const token = match[1];
    const rem = Number(match[2]);
    steps.set(`${rem}rem`, token);
    steps.set(`${rem * 16}px`, token);
  }
  return steps;
}

describe('spacing tokens (UX-105)', () => {
  const tokensCss = readFileSync(join(srcRoot, 'styles', 'tokens.css'), 'utf8');

  it('defines all eight --space-* scale steps in tokens.css', () => {
    for (const token of [
      '--space-1',
      '--space-2',
      '--space-3',
      '--space-4',
      '--space-5',
      '--space-6',
      '--space-7',
      '--space-8',
    ]) {
      expect(
        new RegExp(`${token}\\s*:`).test(tokensCss),
        `${token} should be defined in tokens.css`
      ).toBe(true);
    }
  });

  it('uses --space-* tokens for exact scale-step spacing values', () => {
    const steps = spaceTokenSteps(tokensCss);
    const offenders: string[] = [];

    for (const file of cssFiles(srcRoot)) {
      const css = readFileSync(file, 'utf8');
      const cssWithoutComments = css.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
        ' '.repeat(comment.length)
      );
      const declarations = /(^|[;{}])\s*([\w-]+)\s*:\s*([^;{}]+);/gm;

      for (const declaration of cssWithoutComments.matchAll(declarations)) {
        const property = declaration[2];
        const value = declaration[3];
        if (!spacingProperties.test(property)) continue;

        for (const literal of value.matchAll(spacingLiteral)) {
          const key = `${Number(literal[1])}${literal[2]}`;
          const token = steps.get(key);
          if (!token) continue;

          const line = css.slice(0, declaration.index).split('\n').length;
          offenders.push(`${file}:${line}: ${property}: ${value.trim()} -> var(${token})`);
        }
      }
    }

    expect(
      offenders,
      `Raw spacing values that exactly match --space-* steps must use the token:\n${offenders.join('\n')}`
    ).toEqual([]);
  });
});
