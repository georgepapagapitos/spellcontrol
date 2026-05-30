/**
 * Rules-grounded oracle-text primitives for the synergy engine.
 *
 * MtG oracle text is highly templated, so functional classification is
 * pattern-matching — but only if the well-known traps are handled. Everything
 * here is built and validated against *real* Scryfall text (see
 * `classify.fixtures.ts`), not memory. Pure + isomorphic: no DOM, no network.
 */

export interface ParsedCard {
  name: string;
  typeLine: string;
  /** Lowercased, reminder-stripped, both faces joined. */
  oracle: string;
  /** Raw oracle (lowercased) WITH reminder text — for the rare predicate that needs it. */
  oracleRaw: string;
  keywords: string[];
}

/** Card shape we accept — a subset of ScryfallCard, plus DFC faces. */
export interface CardLike {
  name: string;
  type_line?: string;
  oracle_text?: string;
  keywords?: string[];
  card_faces?: Array<{ oracle_text?: string; type_line?: string }>;
}

/** Remove reminder text — parenthetical glosses never change function. */
export function stripReminder(text: string): string {
  return text.replace(/\([^)]*\)/g, ' ');
}

/** Lowercase + collapse whitespace. */
export function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Join both faces' oracle text (front+back) into one lowercased blob. */
function joinFaces(card: CardLike): { withReminder: string; typeLine: string } {
  const parts: string[] = [];
  if (card.oracle_text) parts.push(card.oracle_text);
  for (const f of card.card_faces ?? []) if (f.oracle_text) parts.push(f.oracle_text);
  const typeLine = card.type_line ?? card.card_faces?.[0]?.type_line ?? '';
  // Newline → clause break; "//" between faces.
  return { withReminder: normalize(parts.join('\n')), typeLine: typeLine.toLowerCase() };
}

export function parseCard(card: CardLike): ParsedCard {
  const { withReminder, typeLine } = joinFaces(card);
  return {
    name: card.name,
    typeLine,
    oracle: normalize(stripReminder(withReminder)),
    oracleRaw: withReminder,
    keywords: (card.keywords ?? []).map((k) => k.toLowerCase()),
  };
}

/** Split into clauses on sentence / ability / bullet / face boundaries. */
export function splitClauses(oracle: string): string[] {
  return oracle
    .split(/[.;\n•]|\s\/\/\s/)
    .map((c) => c.trim())
    .filter(Boolean);
}

// ── Token creation, with controller + kind detection ────────────────────────

const NONCREATURE_TOKEN =
  /\b(treasure|food|clue|blood|gold|powerstone|map|incubator|junk|shard|walker|gem)\b token/;

/**
 * Subjects that mean the token is made by someone OTHER than you — these are
 * removal / political effects, not producers ("Its controller creates a 3/3…").
 * We only look at the words immediately before the `create` verb.
 */
const OPPONENT_SUBJECT =
  /(its controller|that player|target opponent|target player|each opponent|each player|defending player|that opponent|enchanted [a-z]+'s controller)\s*$/;

export interface TokenCreation {
  /** Makes creature tokens under your control. */
  creaturesForYou: boolean;
  /** Makes noncreature (Treasure/Food/Clue/…) tokens under your control. */
  noncreatureForYou: boolean;
  /** Distinct token kinds detected ("creature", "treasure", …). */
  kinds: string[];
}

/**
 * Detect token creation by *you*, distinguishing creature vs noncreature
 * tokens and excluding opponent-attributed creation ("its controller creates").
 */
export function tokenCreation(oracle: string): TokenCreation {
  const kinds = new Set<string>();
  let creaturesForYou = false;
  let noncreatureForYou = false;

  const re = /\bcreates?\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(oracle)) !== null) {
    const before = oracle.slice(Math.max(0, m.index - 32), m.index);
    const after = oracle.slice(m.index, m.index + 90);
    if (!/\btokens?\b/.test(after)) continue;

    // The token belongs to you unless the nearest preceding subject is an
    // opponent AND "you" doesn't also appear right before the verb (handles
    // "…that player… , you create a Treasure token").
    const sinceLastComma = before.split(',').pop() ?? before;
    const opponent = OPPONENT_SUBJECT.test(before) && !/\byou\b\s*$/.test(sinceLastComma);
    if (opponent) continue;

    if (/creature token/.test(after)) {
      creaturesForYou = true;
      kinds.add('creature');
    }
    const nc = after.match(NONCREATURE_TOKEN);
    if (nc) {
      noncreatureForYou = true;
      kinds.add(nc[1]);
    }
    // Bare "create … token" with a P/T but no explicit "creature token" → still
    // a creature token (e.g. "create a 1/1 … token").
    if (!/creature token/.test(after) && !nc && /\d+\/\d+/.test(after)) {
      creaturesForYou = true;
      kinds.add('creature');
    }
  }
  return { creaturesForYou, noncreatureForYou, kinds: [...kinds] };
}

/** True when text references a creature entering that you'd benefit from. */
export function hasCreatureEtbTrigger(oracle: string): boolean {
  // "Whenever a/another creature (you control) enters" — exclude "this creature"
  // (a self-ETB, not a go-wide payoff).
  return /whenever (?:a|another|one or more) (?:nontoken )?creatures?(?: you control)? enter/.test(
    oracle
  );
}

/** Static anthem / team-buff for creatures you control. */
export function hasCreatureAnthem(oracle: string): boolean {
  return (
    /(?:other )?creature tokens? you control get \+/.test(oracle) ||
    /(?:other )?creatures you control get \+/.test(oracle) ||
    /creatures you control gain /.test(oracle) ||
    /creatures you control have (?:base power|")/.test(oracle)
  );
}

/** Scales with your board ("for each creature", "equal to the number of creatures"). */
export function scalesWithCreatures(oracle: string): boolean {
  return (
    /for each creature you control/.test(oracle) ||
    /equal to the number of creatures you control/.test(oracle) ||
    /\+1\/\+1 counter on each creature you control/.test(oracle)
  );
}

/** Token doubler / replacer ("twice that many of those tokens", Divine Visitation). */
export function isTokenDoubler(oracle: string): boolean {
  return (
    /twice that many of those tokens/.test(oracle) ||
    /one or more (?:creature )?tokens would be created/.test(oracle)
  );
}
