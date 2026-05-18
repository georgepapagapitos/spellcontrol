/**
 * Scope-aware migration of a reassignable `generateDeck` result-local onto the
 * shared `GenerationState` bag (`local X` -> `state.X`).
 *
 * Why this exists: the module singleton `generationCache` has properties with
 * the SAME names as these locals (e.g. `generationCache!.edhrecData`). A textual
 * `\bX\b` rewrite corrupts `generationCache!.X` into `generationCache!.state.X`.
 * This codemod uses the TypeScript LanguageService (`findRenameLocations`),
 * which is symbol-driven, so only the function-local binding's references are
 * touched; the `GenerationCache` property accesses are a different symbol and
 * are excluded by construction (as are name occurrences in comments/strings).
 *
 * Mechanic (matches ~/.claude/plans/continue-...kahn.md "Step 0b"):
 *  1. LanguageService built from the real frontend/tsconfig.json (paths alias
 *     honored; single-file synthetic programs degrade getRenameInfo).
 *  2. Locate the function-scoped `let X = <init>` inside `generateDeck`.
 *  3. Initializer-equivalence guard vs. createState's `state.X` initializer:
 *     provably-equivalent  -> delete the whole `let` line (createState already
 *     seeds it); not equivalent -> rewrite the line to `state.X = <init>;`.
 *  4. findRenameLocations -> per location, dispatch on AST node kind:
 *     ShorthandPropertyAssignment -> expand to `X: state.X`;
 *     anything else               -> textual prefix `state.`.
 *  5. Edits applied right-to-left; all edits asserted in deckGenerator.ts only.
 *
 * Usage (one name per invocation for atomic, golden-gated revert):
 *   node scripts/deckgen-migrate-result-local.mjs <varName> [--dry]
 *
 * Reusable: Tier 2 runs it for `detectedCombos`, etc.
 */
import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TSCONFIG = resolve(FRONTEND_ROOT, 'tsconfig.json');
const TARGET_REL = 'src/deck-builder/services/deckBuilder/deckGenerator.ts';
const STATE_REL = 'src/deck-builder/services/deckBuilder/deckGeneration/state.ts';
const TARGET_FILE = resolve(FRONTEND_ROOT, TARGET_REL);
const STATE_FILE = resolve(FRONTEND_ROOT, STATE_REL);
const ENCLOSING_FN = 'generateDeck';
const STATE_OBJ = 'state';
const STATE_FACTORY = 'createState';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const varName = args.find((a) => !a.startsWith('--'));
if (!varName) {
  console.error('usage: node scripts/deckgen-migrate-result-local.mjs <varName> [--dry]');
  process.exit(2);
}

function die(msg) {
  console.error(`\n  ABORT (${varName}): ${msg}\n`);
  process.exit(1);
}

// --- Build a LanguageService from the real tsconfig (paths alias included). ---
const cfgRead = ts.readConfigFile(TSCONFIG, ts.sys.readFile);
if (cfgRead.error) die(`cannot read tsconfig: ${cfgRead.error.messageText}`);
const parsed = ts.parseJsonConfigFileContent(cfgRead.config, ts.sys, FRONTEND_ROOT);
const fileVersions = new Map(parsed.fileNames.map((f) => [resolve(f), 0]));
if (![...fileVersions.keys()].includes(TARGET_FILE)) {
  // ensure the target is in the program even if include globs miss it
  fileVersions.set(TARGET_FILE, 0);
}

const host = {
  getScriptFileNames: () => [...fileVersions.keys()],
  getScriptVersion: (f) => String(fileVersions.get(resolve(f)) ?? 0),
  getScriptSnapshot: (f) => {
    try {
      return ts.ScriptSnapshot.fromString(readFileSync(f, 'utf8'));
    } catch {
      return undefined;
    }
  },
  getCurrentDirectory: () => FRONTEND_ROOT,
  getCompilationSettings: () => parsed.options,
  getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
  readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists,
  getDirectories: ts.sys.getDirectories,
};
const service = ts.createLanguageService(host, ts.createDocumentRegistry());

const program = service.getProgram();
const sf = program.getSourceFile(TARGET_FILE);
if (!sf) die(`could not load source file ${TARGET_FILE}`);
const stateSf = program.getSourceFile(STATE_FILE);
if (!stateSf) die(`could not load state file ${STATE_FILE}`);

// --- Locate the `let X` declaration inside generateDeck. ---
function findFunction(node, name) {
  let found;
  const visit = (n) => {
    if (found) return;
    if (
      (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n)) &&
      n.name &&
      n.name.getText(sf) === name
    ) {
      found = n;
      return;
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}
const fn = findFunction(sf, ENCLOSING_FN);
if (!fn) die(`function ${ENCLOSING_FN} not found`);

const decls = [];
(function collect(n) {
  if (
    ts.isVariableDeclaration(n) &&
    ts.isIdentifier(n.name) &&
    n.name.text === varName &&
    // function-body scoped (parent VariableDeclarationList -> VariableStatement
    // whose parent is the function body block), not a nested-function shadow
    ts.isVariableDeclarationList(n.parent) &&
    ts.isVariableStatement(n.parent.parent) &&
    n.parent.parent.parent === fn.body
  ) {
    decls.push(n);
  }
  ts.forEachChild(n, collect);
})(fn.body);
if (decls.length !== 1) die(`expected exactly 1 function-scoped \`let ${varName}\`, found ${decls.length}`);
const decl = decls[0];
const declList = decl.parent;
const varStmt = declList.parent;
if (declList.declarations.length !== 1) die(`declaration list has >1 declarator; not supported`);
if (!decl.initializer) die(`\`${varName}\` has no initializer; equivalence guard cannot run`);

// --- Initializer-equivalence guard vs. createState's `state.X` initializer. ---
function findCreateStateInitializer() {
  let init;
  const visit = (n) => {
    if (init) return;
    if (ts.isReturnStatement(n) && n.expression && ts.isObjectLiteralExpression(n.expression)) {
      for (const p of n.expression.properties) {
        if (
          (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
          p.name &&
          ts.isIdentifier(p.name) &&
          p.name.text === varName
        ) {
          init = ts.isPropertyAssignment(p) ? p.initializer : p.name;
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  // restrict to the createState function
  const csFn = findFunctionIn(stateSf, STATE_FACTORY);
  if (!csFn) die(`${STATE_FACTORY} not found in state.ts`);
  ts.forEachChild(csFn, visit);
  return init;
}
function findFunctionIn(root, name) {
  let found;
  const visit = (n) => {
    if (found) return;
    if (ts.isFunctionDeclaration(n) && n.name && n.name.text === name) {
      found = n;
      return;
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(root, visit);
  return found;
}
// Normalize an initializer: strip type arguments + trivia, print canonically.
function normalize(node, srcFile) {
  const stripped = ts.transform(node, [
    (ctx) => (root) => {
      const v = (n) => {
        n = ts.visitEachChild(n, v, ctx);
        if (ts.isNewExpression(n)) {
          return ctx.factory.updateNewExpression(n, n.expression, undefined, n.arguments ?? ctx.factory.createNodeArray([]));
        }
        if (ts.isCallExpression(n)) {
          return ctx.factory.updateCallExpression(n, n.expression, undefined, n.arguments);
        }
        return n;
      };
      return ts.visitNode(root, v);
    },
  ]).transformed[0];
  const printer = ts.createPrinter({ removeComments: true, omitTrailingSemicolon: true });
  return printer
    .printNode(ts.EmitHint.Unspecified, stripped, srcFile ?? sf)
    .replace(/\s+/g, ' ')
    .trim();
}
const csInit = findCreateStateInitializer();
if (!csInit) die(`createState has no \`${varName}\` property to compare against`);
const declNorm = normalize(decl.initializer, sf);
const csNorm = normalize(csInit, stateSf);
const equivalent = declNorm === csNorm;
console.log(`  initializer  let: ${declNorm}`);
console.log(`  initializer  createState: ${csNorm}`);
console.log(`  -> ${equivalent ? 'EQUIVALENT (delete decl)' : 'NOT equivalent (re-seed: state.X = init)'}`);

// --- findRenameLocations on the declaration identifier. ---
const declNameStart = decl.name.getStart(sf);
const renameInfo = service.getRenameInfo(TARGET_FILE, declNameStart, {});
if (!renameInfo || renameInfo.canRename !== true) die(`getRenameInfo.canRename !== true`);
const locs = service.findRenameLocations(TARGET_FILE, declNameStart, false, false, {});
if (!locs || locs.length === 0) die(`findRenameLocations returned nothing`);
for (const l of locs) {
  if (resolve(l.fileName) !== TARGET_FILE) die(`rename location outside target file: ${l.fileName}`);
}
const includesDecl = locs.some((l) => l.textSpan.start === declNameStart);
if (!includesDecl) die(`rename set does not include the declaration site`);

// Sanity tripwire: assert none of the spans is a `generationCache!.X` property.
const text = readFileSync(TARGET_FILE, 'utf8');
function nodeAt(start, end) {
  let hit;
  const visit = (n) => {
    if (n.getStart(sf) <= start && n.getEnd() >= end) {
      hit = n;
      ts.forEachChild(n, visit);
    }
  };
  visit(sf);
  return hit;
}

let nShorthand = 0;
let nPrefix = 0;
const edits = []; // { start, end, text }
for (const l of locs) {
  const { start, length } = l.textSpan;
  const end = start + length;
  if (start === declNameStart) continue; // handled by decl line removal/reseed
  const node = nodeAt(start, end);
  if (!node || !ts.isIdentifier(node)) die(`no Identifier at rename span ${start}..${end}`);
  if (
    ts.isPropertyAccessExpression(node.parent) &&
    node.parent.name === node
  ) {
    die(`span ${start} is a property name (\`.${varName}\`) — would be the cache collision`);
  }
  if (ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node) {
    edits.push({ start, end, text: `${varName}: ${STATE_OBJ}.${varName}` });
    nShorthand++;
  } else {
    edits.push({ start, end, text: `${STATE_OBJ}.${varName}` });
    nPrefix++;
  }
}

// Declaration line: delete whole physical line(s) if equivalent, else re-seed.
function lineStartOf(pos) {
  let i = pos;
  while (i > 0 && text[i - 1] !== '\n') i--;
  return i;
}
function lineEndAfter(pos) {
  let i = pos;
  while (i < text.length && text[i] !== '\n') i++;
  return i < text.length ? i + 1 : i;
}
const stmtStart = varStmt.getStart(sf);
const stmtEnd = varStmt.getEnd();
const delStart = lineStartOf(stmtStart);
const delEnd = lineEndAfter(stmtEnd);
if (equivalent) {
  edits.push({ start: delStart, end: delEnd, text: '' });
} else {
  const indent = text.slice(delStart, stmtStart);
  edits.push({
    start: delStart,
    end: delEnd,
    text: `${indent}${STATE_OBJ}.${varName} = ${decl.initializer.getText(sf)};\n`,
  });
}

// Apply right-to-left; assert non-overlap.
edits.sort((a, b) => b.start - a.start);
for (let i = 1; i < edits.length; i++) {
  if (edits[i].end > edits[i - 1].start) die(`overlapping edits ${JSON.stringify(edits[i])} / ${JSON.stringify(edits[i - 1])}`);
}
let out = text;
for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);

console.log(
  `  ${varName}: ${locs.length} locations -> ${nPrefix} prefixed, ${nShorthand} shorthand-expanded, decl ${equivalent ? 'deleted' : 're-seeded'}`
);
if (DRY) {
  console.log('  --dry: not writing');
} else {
  writeFileSync(TARGET_FILE, out);
  console.log(`  wrote ${TARGET_REL}`);
}
