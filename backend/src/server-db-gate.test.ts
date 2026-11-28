// Guard (E1120): every route server.ts registers that can reach Postgres sits
// behind the boot gate.
//
// The server listens before the schema is applied (db/readiness.ts). A handler
// that reaches db/index.ts and is registered without `requireDb` or
// `dbGate(...)` runs against a database that is unreachable or has no tables
// yet: the request waits out the 10 s connect timeout and fails with a 500
// instead of a fast 503 with Retry-After.
//
// How it decides: it parses server.ts with the TypeScript compiler (comments
// never count) and looks at every `app.<method>(...)` call. Each handler
// argument is resolved to what it refers to, whatever it is named: an import
// (followed, through value imports only, to see whether its module reaches
// db/index.ts), a local alias (`const x = someRouter`), or a function defined
// in server.ts (whose body is resolved the same way). Inline arrow handlers
// are resolved by every name they use.
//
// The fix when this fails: add `requireDb` to that call in server.ts, or
// `dbGate({ except: [...] })` when part of a router needs no database, and
// record the exception list in GATE_EXCEPTIONS below. If the handler checks
// readiness itself, add it to SELF_GATED with the reason; if it only looks
// database-bound because a module it imports also exports database code, add
// it to MODULE_FALSE_POSITIVES with the reason.
//
// Known limits, accepted because closing them needs a type checker rather
// than a parse: reachability is per module, not per function, which is what
// MODULE_FALSE_POSITIVES is for; and SELF_GATED trusts that a listed handler
// checks `isDbReady()` before each write (it checks the call exists, and the
// route's own tests check the behavior, e.g. events.test.ts).

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const SRC = __dirname;
const SERVER = path.join(SRC, 'server.ts');
const DB_INDEX = path.join(SRC, 'db', 'index.ts');
const READINESS = path.join(SRC, 'db', 'readiness.ts');

/** Every `dbGate({ except })` in server.ts, by registration key. Nothing else may pass the gate. */
const GATE_EXCEPTIONS: Record<string, string[]> = {
  'use /api/auth': ['/logout'],
  'use /api/offline': ['/oracle-cards'],
};

const LANDING = 'share landing: skips its Postgres lookup while !isDbReady() (canLookup)';

/** Registered without a gate because the handler checks readiness itself. */
const SELF_GATED: Record<string, string> = {
  'use /api/events':
    'a client-error beacon feeds the in-memory burst alert, the one signal left while the database is down; the router skips its writes until the schema is in',
  'get /s/:token': LANDING,
  'get /d/:token': LANDING,
  'get /u/:token': LANDING,
  'get /b/:token': LANDING,
  'get /l/:token': LANDING,
  'get /gn/s/:token': LANDING,
  'get /gn/:token': LANDING,
};

/** Reach db/index.ts only through a module-level import the handler never calls. */
const MODULE_FALSE_POSITIVES: Record<string, string> = {
  'get BRACKET_PATH':
    'createStaticLandingHandler serves one constant meta; shares/og.ts reaches Postgres only through lookupShareLandingMeta, which it never calls',
};

/** Identifiers used as a registration path rather than a handler. */
const PATH_CONSTANTS = new Set(['BRACKET_PATH']);

const APP_METHODS = new Set(['use', 'get', 'post', 'put', 'patch', 'delete', 'all', 'head']);

function resolveModule(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null; // packages never import our db
  const base = path.resolve(path.dirname(from), spec);
  for (const candidate of [`${base}.ts`, path.join(base, 'index.ts'), base]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
}

/** Relative modules a file loads at runtime (`import type` and type-only names skipped). */
function valueImports(file: string): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const typeOnly = ts.isImportDeclaration(node)
        ? node.importClause?.isTypeOnly
        : node.isTypeOnly;
      const target = resolveModule(file, node.moduleSpecifier.text);
      if (!typeOnly && target) out.push(target);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      const target = resolveModule(file, node.arguments[0].text);
      if (target) out.push(target);
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(file));
  return out;
}

const reachCache = new Map<string, boolean>();
function reachesDb(entry: string): boolean {
  const cached = reachCache.get(entry);
  if (cached !== undefined) return cached;
  const seen = new Set([entry]);
  const queue = [entry];
  let hit = false;
  while (queue.length && !hit) {
    const file = queue.shift()!;
    if (file === DB_INDEX) hit = true;
    else
      for (const next of valueImports(file))
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
  }
  reachCache.set(entry, hit);
  return hit;
}

/** Names declared inside a node (parameters, variables, functions), which shadow outer ones. */
function declaredIn(node: ts.Node): Set<string> {
  const out = new Set<string>();
  const visit = (n: ts.Node) => {
    if (
      (ts.isParameter(n) ||
        ts.isVariableDeclaration(n) ||
        ts.isFunctionDeclaration(n) ||
        ts.isBindingElement(n)) &&
      n.name &&
      ts.isIdentifier(n.name)
    ) {
      out.add(n.name.text);
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(node, visit);
  return out;
}

/**
 * Free names a node uses: property names (`res.json`'s `json`) and names the
 * node declares itself (a handler's own `const start`) left out, so they
 * cannot be mistaken for the server.ts function of the same name.
 */
function namesIn(node: ts.Node): string[] {
  const own = declaredIn(node);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isIdentifier(n)) {
      const p = n.parent;
      const isPropertyName =
        (ts.isPropertyAccessExpression(p) && p.name === n) ||
        (ts.isPropertyAssignment(p) && p.name === n);
      if (!isPropertyName && !own.has(n.text)) out.push(n.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

function callsIsDbReady(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === 'isDbReady'
    )
      found = true;
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

interface Registration {
  key: string;
  gated: boolean;
  gateProblems: string[];
  handlers: ts.Expression[];
}

function analyzeServer(file: string) {
  const sf = parse(file);
  const imports = new Map<string, string | null>(); // local name -> module file (null: package)
  const locals = new Map<string, ts.Node>(); // functions and aliases defined in server.ts
  const registrations: Registration[] = [];

  const gateOf = (arg: ts.Expression, key: string, problems: string[]): boolean => {
    if (ts.isIdentifier(arg) && arg.text === 'requireDb') return true;
    if (!ts.isCallExpression(arg) || !ts.isIdentifier(arg.expression)) return false;
    if (arg.expression.text !== 'dbGate') return false;
    const opts = arg.arguments[0];
    let except: string[] = [];
    if (opts && !ts.isObjectLiteralExpression(opts)) {
      problems.push(`${key}: dbGate options must be an object literal`);
    } else if (opts) {
      for (const prop of opts.properties) {
        const name = prop.name && ts.isIdentifier(prop.name) ? prop.name.text : '?';
        if (name === 'headers') continue;
        if (name !== 'except' || !ts.isPropertyAssignment(prop)) {
          problems.push(`${key}: dbGate option "${name}" is not allowed`);
        } else if (!ts.isArrayLiteralExpression(prop.initializer)) {
          problems.push(`${key}: dbGate except must be an array literal`);
        } else {
          except = prop.initializer.elements.map((e) =>
            ts.isStringLiteral(e) ? e.text : e.getText(sf)
          );
        }
      }
    }
    const allowed = GATE_EXCEPTIONS[key] ?? [];
    if (JSON.stringify(except) !== JSON.stringify(allowed)) {
      problems.push(
        `${key}: dbGate except ${JSON.stringify(except)} is not GATE_EXCEPTIONS ${JSON.stringify(allowed)}`
      );
    }
    return true;
  };

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const target = resolveModule(file, node.moduleSpecifier.text);
      if (clause && !clause.isTypeOnly) {
        if (clause.name) imports.set(clause.name.text, target);
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          for (const el of bindings.elements) if (!el.isTypeOnly) imports.set(el.name.text, target);
        } else if (bindings && ts.isNamespaceImport(bindings)) {
          imports.set(bindings.name.text, target);
        }
      }
    }
    if (ts.isFunctionDeclaration(node) && node.name) locals.set(node.name.text, node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      locals.set(node.name.text, node.initializer);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'app' &&
      APP_METHODS.has(node.expression.name.text)
    ) {
      const args = [...node.arguments];
      let pathText = '(no path)';
      const first = args[0];
      if (first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) {
        pathText = first.text;
        args.shift();
      } else if (first && ts.isIdentifier(first) && PATH_CONSTANTS.has(first.text)) {
        pathText = first.text;
        args.shift();
      } else if (first && ts.isArrayLiteralExpression(first)) {
        pathText = first.getText(sf);
        args.shift();
      }
      const key = `${node.expression.name.text} ${pathText}`;
      const gateProblems: string[] = [];
      let gated = false;
      const handlers: ts.Expression[] = [];
      for (const arg of args) {
        if (gateOf(arg, key, gateProblems)) gated = true;
        else handlers.push(arg);
      }
      registrations.push({ key, gated, gateProblems, handlers });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  /** Whether a name a handler uses leads to db/index.ts. */
  const nameReachesDb = (name: string, seen: Set<string>): boolean => {
    if (seen.has(name)) return false;
    seen.add(name);
    if (imports.has(name)) {
      const target = imports.get(name);
      return !!target && reachesDb(target);
    }
    const local = locals.get(name);
    return !!local && namesIn(local).some((n) => nameReachesDb(n, seen));
  };
  const reaches = (handler: ts.Node) => {
    const seen = new Set<string>();
    return namesIn(handler).some((n) => nameReachesDb(n, seen));
  };

  /** Whether a handler calls isDbReady(), itself, through a local, or in its router's file. */
  const checksReadiness = (handler: ts.Node, seen = new Set<string>()): boolean => {
    if (callsIsDbReady(handler) || namesIn(handler).includes('isDbReady')) return true;
    return namesIn(handler).some((n) => {
      if (seen.has(n)) return false;
      seen.add(n);
      const local = locals.get(n);
      if (local) return checksReadiness(local, seen);
      const file = imports.get(n);
      return (
        !!file &&
        /\/routes\//.test(file) &&
        valueImports(file).includes(READINESS) &&
        callsIsDbReady(parse(file))
      );
    });
  };

  return { registrations, reaches, checksReadiness };
}

describe('server.ts database gate', () => {
  const { registrations, reaches, checksReadiness } = analyzeServer(SERVER);

  it('finds the registrations server.ts makes', () => {
    expect(registrations.length).toBeGreaterThan(50);
    expect(registrations.some((r) => r.key === 'use /api/friends' && r.gated)).toBe(true);
  });

  it('gates every registration whose handler reaches db/index.ts', () => {
    const ungated = registrations
      .filter((r) => !r.gated && !(r.key in SELF_GATED) && !(r.key in MODULE_FALSE_POSITIVES))
      .filter((r) => r.handlers.some(reaches))
      .map((r) => `${r.key}: ${r.handlers.map((h) => h.getText().slice(0, 50)).join(', ')}`);
    expect(ungated, 'Add requireDb to these calls in server.ts').toEqual([]);
  });

  it('allows only the recorded dbGate exceptions, and no other gate options', () => {
    expect(registrations.flatMap((r) => r.gateProblems)).toEqual([]);
    const used = registrations.filter((r) => r.key in GATE_EXCEPTIONS && r.gated).map((r) => r.key);
    expect(used.sort()).toEqual(Object.keys(GATE_EXCEPTIONS).sort());
  });

  it('keeps the allowlists true', () => {
    const byKey = new Map(registrations.map((r) => [r.key, r]));
    for (const key of [...Object.keys(SELF_GATED), ...Object.keys(MODULE_FALSE_POSITIVES)]) {
      const r = byKey.get(key);
      expect(r, `${key} is listed but not registered`).toBeDefined();
      expect(r!.gated, `${key} is listed but gated`).toBe(false);
      expect(r!.handlers.some(reaches), `${key} is listed but never reaches the database`).toBe(
        true
      );
    }
    for (const key of Object.keys(SELF_GATED)) {
      const r = byKey.get(key)!;
      expect(
        r.handlers.some((h) => checksReadiness(h)),
        `${key} must check isDbReady()`
      ).toBe(true);
    }
  });
});
