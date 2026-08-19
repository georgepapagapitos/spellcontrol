import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { toMatchExpression } from '../cache';

/**
 * Local index over the Magic Comprehensive Rules, for the rules Q&A feature.
 *
 * Deliberately FTS5 + BM25, not embeddings: the CR is the best possible corpus
 * for keyword search — rigidly numbered rules, a controlled vocabulary, and a
 * glossary mapping player-speak to official terms — and the caller is a model
 * that reformulates its own queries. One row per numbered rule/subrule plus one
 * per glossary term, ~3.5k rows total, so the non-MATCH lookups below are plain
 * scans and still instant.
 */

export interface RuleEntry {
  /** "601.2b", a section like "601", or a glossary term like "Deathtouch". */
  ref: string;
  body: string;
}

export interface RulesStatus {
  count: number;
  sourceUrl: string | null;
  /** Human-readable, straight from the document ("August 7, 2026"). */
  effectiveDate: string | null;
  ingestedAt: number | null;
}

/** Rows returned for a bare section number — mostly one-line rule titles. */
const SECTION_ROW_CAP = 60;

/**
 * Parse the official Comprehensive Rules `.txt` into indexable entries.
 *
 * The document is: intro + table of contents, the numbered rules, a `Glossary`
 * body, then `Credits`. Rules are one per line — `601. Casting Spells` (section
 * title), `601.2. To cast a spell…`, `601.2b If the spell is modal…` — with
 * `Example: …` lines attached to the rule above them. The TOC repeats every
 * section title, which the Map below dedupes by ref (body wins, same text).
 * Glossary entries are blank-line-separated paragraphs: term line, then the
 * definition.
 */
export function parseComprehensiveRules(text: string): RuleEntry[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);

  // The literal lines "Glossary" and "Credits" appear twice: once in the TOC,
  // once opening the real section. The last occurrences are the real ones.
  const glossaryAt = lines.reduce((at, l, i) => (l.trim() === 'Glossary' ? i : at), -1);
  const creditsAt = lines.reduce(
    (at, l, i) => (l.trim() === 'Credits' && i > glossaryAt ? i : at),
    lines.length
  );

  const entries = new Map<string, string>();
  let lastRuleRef: string | null = null;

  const rulesEnd = glossaryAt === -1 ? lines.length : glossaryAt;
  for (let i = 0; i < rulesEnd; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // `[a-z]*` not `[a-z]?`: the CR skips letters l and o and could in
    // principle run past z (the frontend's refresh-rules.mjs parser allows the
    // same) — a rule the regex can't see would vanish from the corpus.
    const rule = line.match(/^(\d{3}\.\d+[a-z]*)\.? (.+)$/);
    if (rule) {
      entries.set(rule[1], rule[2]);
      lastRuleRef = rule[1];
      continue;
    }
    const section = line.match(/^(\d{3})\. (.+)$/);
    if (section) {
      entries.set(section[1], section[2]);
      lastRuleRef = null;
      continue;
    }
    if (/^Example: /.test(line) && lastRuleRef) {
      entries.set(lastRuleRef, `${entries.get(lastRuleRef)}\n${line}`);
    }
  }

  if (glossaryAt !== -1) {
    let term: string | null = null;
    let body: string[] = [];
    const flush = () => {
      // A term that collides with a rule ref can't happen (terms aren't
      // numbers), but an empty definition means we misread a stray line — skip.
      if (term && body.length > 0) entries.set(term, body.join('\n'));
      term = null;
      body = [];
    };
    for (let i = glossaryAt + 1; i < creditsAt; i++) {
      const line = lines[i].trim();
      if (!line) {
        flush();
        continue;
      }
      if (term === null) term = line;
      else body.push(line);
    }
    flush();
  }

  return [...entries].map(([ref, body]) => ({ ref, body }));
}

/** Numeric-aware ordering for rule refs, so 601.2 sorts before 601.10. */
export function compareRuleRefs(a: string, b: string): number {
  const parse = (r: string) => {
    const m = r.match(/^(\d{3})(?:\.(\d+)([a-z]*))?$/);
    return m ? [Number(m[1]), Number(m[2] ?? 0), m[3] ?? ''] : null;
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return a.localeCompare(b);
  return (
    (pa[0] as number) - (pb[0] as number) ||
    (pa[1] as number) - (pb[1] as number) ||
    (pa[2] as string).localeCompare(pb[2] as string)
  );
}

export class RulesIndex {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS rules_fts USING fts5(
        ref UNINDEXED,
        body,
        tokenize = 'unicode61 remove_diacritics 2'
      );
      CREATE TABLE IF NOT EXISTS rules_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  /** Swap in a freshly parsed document atomically. */
  replaceAll(
    entries: RuleEntry[],
    meta: { sourceUrl: string; effectiveDate: string | null }
  ): void {
    const insert = this.db.prepare('INSERT INTO rules_fts (ref, body) VALUES (?, ?)');
    const setMeta = this.db.prepare('INSERT OR REPLACE INTO rules_meta (key, value) VALUES (?, ?)');
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM rules_fts').run();
      for (const e of entries) insert.run(e.ref, e.body);
      setMeta.run('source_url', meta.sourceUrl);
      if (meta.effectiveDate) setMeta.run('effective_date', meta.effectiveDate);
      setMeta.run('ingested_at', String(Date.now()));
    })();
  }

  /** Plain-language full-text search, best match first. */
  search(query: string, limit = 8): RuleEntry[] {
    const match = toMatchExpression(query);
    if (!match) return [];
    try {
      return this.db
        .prepare('SELECT ref, body FROM rules_fts WHERE rules_fts MATCH ? ORDER BY rank LIMIT ?')
        .all(match, Math.min(Math.max(1, Math.trunc(limit)), 20)) as RuleEntry[];
    } catch {
      return [];
    }
  }

  /** The one row for exactly this ref (or glossary term), else null. */
  getExact(ref: string): RuleEntry | null {
    const row = this.db
      .prepare('SELECT ref, body FROM rules_fts WHERE ref = ? COLLATE NOCASE LIMIT 1')
      .get(ref.trim()) as RuleEntry | undefined;
    return row ?? null;
  }

  /**
   * A ref plus its immediate children: `601.2` → 601.2 and 601.2a–z; a bare
   * `601` → the section title and its top-level rules (capped — that listing is
   * mostly one-line titles the model can drill into); anything else (a full
   * subrule ref, a glossary term) → just that row.
   */
  get(refRaw: string): RuleEntry[] {
    const ref = refRaw.trim().replace(/\.$/, '');
    let rows: RuleEntry[];
    if (/^\d{3}$/.test(ref)) {
      rows = this.db
        .prepare(
          `SELECT ref, body FROM rules_fts
            WHERE ref = ? OR (ref GLOB ? AND NOT ref GLOB '*[a-z]')`
        )
        .all(ref, `${ref}.*`) as RuleEntry[];
      rows = rows.sort((a, b) => compareRuleRefs(a.ref, b.ref)).slice(0, SECTION_ROW_CAP);
    } else if (/^\d{3}\.\d+$/.test(ref)) {
      rows = this.db
        .prepare('SELECT ref, body FROM rules_fts WHERE ref = ? OR ref GLOB ?')
        .all(ref, `${ref}[a-z]*`) as RuleEntry[];
      rows.sort((a, b) => compareRuleRefs(a.ref, b.ref));
    } else {
      const one = this.getExact(ref);
      rows = one ? [one] : [];
    }
    return rows;
  }

  status(): RulesStatus {
    const count = (this.db.prepare('SELECT COUNT(*) AS n FROM rules_fts').get() as { n: number }).n;
    const meta = new Map(
      (
        this.db.prepare('SELECT key, value FROM rules_meta').all() as {
          key: string;
          value: string;
        }[]
      ).map((r) => [r.key, r.value])
    );
    const ingested = meta.get('ingested_at');
    return {
      count,
      sourceUrl: meta.get('source_url') ?? null,
      effectiveDate: meta.get('effective_date') ?? null,
      ingestedAt: ingested ? Number(ingested) : null,
    };
  }

  close(): void {
    this.db.close();
  }
}

export const RULES_DB_PATH =
  process.env.RULES_DB_PATH || path.join(__dirname, '..', '..', 'data', 'rules.db');

let instance: RulesIndex | null = null;

/** The process-wide rules index. Created lazily on first use. */
export function getRulesIndex(): RulesIndex {
  if (!instance) instance = new RulesIndex(RULES_DB_PATH);
  return instance;
}
