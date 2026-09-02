// @vitest-environment node
/**
 * Guard: every class a module renders must be defined in a stylesheet that
 * is actually loaded when that module is on screen.
 *
 * The app is code-split by hub (App.tsx `lazyPage`), and Vite ships a
 * stylesheet with the chunk of whichever module imports it. A page that
 * reuses another chunk's classes by name — TradesPage rendering the guest
 * gate with FriendsManagement's `.friends-signin-*`, RulesPage putting the
 * review panel's `.deck-ai-marker` on its title — renders fine in a session
 * that already visited the owning page, and renders as bare unstyled text
 * on a direct load of its own URL. CSS is not typecheck/lint-gated, so
 * nothing else in the gate notices; both of those examples shipped.
 *
 * The check mirrors what the bundler does:
 *   - entries are main.tsx plus the target of every dynamic `import()`;
 *   - a module reachable from an entry through static imports is in that
 *     entry's chunk, and so is every stylesheet it statically imports;
 *   - an entry's page can also rely on main.tsx's global stylesheets and on
 *     the chunks of the entries that dynamically imported it (they were
 *     already loaded to trigger the import).
 * For each entry, every class token found in a string literal of one of its
 * modules that is defined by some `src` stylesheet must be defined by a
 * stylesheet that entry loads. Tokens with no `src` definition at all
 * (mana-font, keyrune, plain strings) are ignored, as are hyphen-less tokens
 * (`active`, `checked`) — every app class is hyphenated, and a bare word in
 * a string is far more often data than a class.
 *
 * Fix a failure by moving the rules into a stylesheet the using chunk loads:
 * a shared family into `src/styles/` (imported by main.tsx), a component's
 * own classes into its co-located `Component.css`, or an explicit stylesheet
 * import in the borrowing module. Never by copying the rules.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = walk(srcDir);
const isTest = (f: string) => /\.(test|eval|live\.test)\.tsx?$/.test(f) || f.includes('/test/');
const modules = files.filter((f) => /\.(ts|tsx)$/.test(f) && !isTest(f));
const stylesheets = files.filter((f) => f.endsWith('.css'));
const rel = (f: string) => relative(srcDir, f);

// ── Stylesheets: which classes each one defines ─────────────────────────────
function classesDefined(css: string): Set<string> {
  const out = new Set<string>();
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // A selector is the text between the previous block boundary and a `{`.
  // Declarations sit inside blocks, so `.5rem`-style numbers never reach the
  // class regex; at-rule preludes (`@media (...) {`) carry no class tokens.
  for (const m of stripped.matchAll(/([^{};]*)\{/g)) {
    for (const c of m[1].matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) out.add(c[1]);
  }
  return out;
}
const definedBy = new Map<string, Set<string>>();
for (const sheet of stylesheets) definedBy.set(sheet, classesDefined(readFileSync(sheet, 'utf8')));
const definedAnywhere = new Set<string>();
for (const set of definedBy.values()) for (const c of set) definedAnywhere.add(c);

// ── Modules: static imports, dynamic imports, class tokens ─────────────────
function resolveSpec(from: string, spec: string): string | null {
  const base = spec.startsWith('@/')
    ? join(srcDir, spec.slice(2))
    : spec.startsWith('.')
      ? join(dirname(from), spec)
      : null;
  if (!base) return null;
  for (const ext of ['', '.ts', '.tsx', '.css', '/index.ts', '/index.tsx']) {
    const candidate = base + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

interface ModuleInfo {
  staticImports: string[];
  dynamicImports: string[];
  classTokens: Set<string>;
}
const info = new Map<string, ModuleInfo>();
for (const mod of modules) {
  const src = readFileSync(mod, 'utf8');
  // `import type` / `export type … from` are erased at build time and load
  // nothing, so they carry no stylesheet.
  const staticImports = [
    ...src.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^'";]*?from\s+['"]([^'"]+)['"]/g),
    ...src.matchAll(/(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g),
  ]
    .map((m) => resolveSpec(mod, m[1]))
    .filter((f): f is string => f !== null);
  const dynamicImports = [...src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)]
    .map((m) => resolveSpec(mod, m[1]))
    .filter((f): f is string => f !== null && /\.tsx?$/.test(f));
  const classTokens = new Set<string>();
  // Comments name classes in prose ("(e.g. `card-group-img`)") — only code
  // renders them, so strip block and line comments before tokenising. A `//`
  // that follows `:` is a URL scheme inside a string, not a comment.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
  for (const lit of code.matchAll(/(["'])((?:\\.|(?!\1)[^\\\n])*)\1|`((?:\\.|[^\\`])*)`/g)) {
    // Template literals keep only their static text; `${…}` holes are dropped.
    const text = lit[3] !== undefined ? lit[3].replace(/\$\{[^}]*\}/g, ' ') : lit[2];
    for (const token of text.split(/\s+/)) {
      if (token.includes('-') && definedAnywhere.has(token)) classTokens.add(token);
    }
  }
  info.set(mod, { staticImports, dynamicImports, classTokens });
}

/** Modules + stylesheets in a chunk rooted at `entry` (static closure). */
function chunkOf(entry: string): { modules: Set<string>; sheets: Set<string> } {
  const mods = new Set<string>();
  const sheets = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop()!;
    if (f.endsWith('.css')) {
      sheets.add(f);
      continue;
    }
    if (mods.has(f)) continue;
    mods.add(f);
    for (const dep of info.get(f)?.staticImports ?? []) stack.push(dep);
  }
  return { modules: mods, sheets };
}

const mainEntry = join(srcDir, 'main.tsx');
const chunks = new Map<string, ReturnType<typeof chunkOf>>();
const parents = new Map<string, Set<string>>();
// Discover entries: main plus every dynamic-import target reachable from an
// already-discovered chunk (nested lazy imports included).
const pending = [mainEntry];
while (pending.length) {
  const entry = pending.pop()!;
  if (chunks.has(entry)) continue;
  const chunk = chunkOf(entry);
  chunks.set(entry, chunk);
  for (const mod of chunk.modules) {
    for (const child of info.get(mod)?.dynamicImports ?? []) {
      if (!parents.has(child)) parents.set(child, new Set());
      parents.get(child)!.add(entry);
      pending.push(child);
    }
  }
}

function sheetsAvailableTo(entry: string): Set<string> {
  const out = new Set<string>(chunks.get(mainEntry)!.sheets);
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const e = stack.pop()!;
    if (seen.has(e)) continue;
    seen.add(e);
    for (const sheet of chunks.get(e)?.sheets ?? []) out.add(sheet);
    for (const parent of parents.get(e) ?? []) stack.push(parent);
  }
  return out;
}

describe('css chunk ownership (code-split by hub)', () => {
  it('discovers the lazy route entries', () => {
    // Sanity: the check is only meaningful if App.tsx's lazyPage() targets
    // were found. Pick two from different hubs.
    expect(chunks.has(join(srcDir, 'pages', 'TradesPage.tsx'))).toBe(true);
    expect(chunks.has(join(srcDir, 'pages', 'RulesPage.tsx'))).toBe(true);
  });

  it('every class a chunk renders is defined in a stylesheet that chunk loads', () => {
    const offenders: string[] = [];
    for (const [entry, chunk] of chunks) {
      const available = sheetsAvailableTo(entry);
      const definedHere = new Set<string>();
      for (const sheet of available) for (const c of definedBy.get(sheet) ?? []) definedHere.add(c);
      for (const mod of chunk.modules) {
        const missing = [...(info.get(mod)?.classTokens ?? [])].filter((c) => !definedHere.has(c));
        if (missing.length === 0) continue;
        const owners = new Set<string>();
        for (const [sheet, set] of definedBy) {
          if (missing.some((c) => set.has(c))) owners.add(rel(sheet));
        }
        offenders.push(
          `${rel(mod)} (loaded by ${rel(entry)}) uses ${missing.join(', ')} — defined only in ${[...owners].join(', ')}`
        );
      }
    }
    expect(
      offenders,
      `Classes rendered by a chunk that never loads their stylesheet:\n  ${offenders.join('\n  ')}\n` +
        'Move the rules into a stylesheet that chunk loads (see the header comment).'
    ).toEqual([]);
  });
});
