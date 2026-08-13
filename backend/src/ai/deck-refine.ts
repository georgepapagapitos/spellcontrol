import crypto from 'node:crypto';
import { renderAnalysis, type OracleEntry } from './deck-review';

/**
 * The post-generation refine step (T102 slice 4). The deterministic generator
 * builds the deck; this is the optional second pass that explains what it built
 * and proposes a handful of changes it did not make.
 *
 * The load-bearing constraint: **the model curates, it never invents.** Every
 * card it may propose is supplied by the engine in a candidate pool, and every
 * name it returns is verified against that pool here before the client ever
 * sees it. A hallucinated name is dropped, not surfaced — the prompt is the
 * first line of defence and {@link parseRefineOutput} is the second.
 *
 * The prompt is the feature and is eval-gated exactly like the review prompt:
 * change it only with an eval run.
 */
export const DECK_REFINE_FEATURE = 'deck-refine';

/** Cap on what the model may propose, enforced again after parsing. */
export const MAX_TWEAKS = 5;

/** Separates the streamed prose from the machine-readable tail. */
export const TWEAKS_DELIMITER = '---TWEAKS---';

export const DECK_REFINE_SYSTEM_PROMPT = `You are a Magic: The Gathering deck analyst inside SpellControl, a
collection and deckbuilding app. A deterministic engine has just generated
a Commander deck for the player. You are the optional second pass: you say
what the engine built, and you propose a few changes it did not make.

You will be given the generated decklist, the statistics the app computed,
and a CANDIDATE POOL - cards the engine considered and passed over, cards
that match this deck's themes, and, when the player is building from their
own collection, cards they physically own.

Reply in exactly three parts, in this order:

1. Two or three short paragraphs of plain prose: what this deck is actually
   trying to do, and how it wins. Name the specific cards that define it.
   Second person ("your deck"). No headers, no bullet lists, no preamble.

2. A line containing exactly ${TWEAKS_DELIMITER} and nothing else.

3. A JSON array of proposed changes, and nothing after it.

Each element is an object:
  {"add": "<exact card name from the CANDIDATE POOL>",
   "cut": "<exact card name from the decklist, or null>",
   "why": "<one sentence, specific to this deck>"}

The rules on those changes are what make you useful rather than dangerous:

- "add" MUST be copied exactly from the CANDIDATE POOL. Not a card you know
  is strong. Not a card already in the decklist. If the pool holds nothing
  that improves this deck, propose nothing. A famous staple that is not in
  the pool is not available to you, however much the deck wants it.
- "cut" MUST be copied exactly from the decklist, or be null. Never cut the
  commander. Never cut a basic land.
- At most ${MAX_TWEAKS} changes, and fewer is better. The engine's list is
  already legal, on-colour and on-curve. You are curating, not rebuilding.
  Most generated decks need zero to two changes. Reserve five for a deck with
  a genuine structural hole.
- Every "why" must be specific to THIS deck and THIS commander: what the
  added card does here that the cut card does not. "It is a better card" is
  not a reason. "It is a staple" is not a reason. "It is good value" is not
  a reason.
- If the deck does not need changes, return an empty array. A generated deck
  that already works is a success, not a failure to find something. Do not
  manufacture churn to look useful.
- Do not break the mana base. If you cut a land, add a land.

Apply BOTH of these tests to every change before you propose it. A change
that fails either one is worse than no change at all:

TEST 1 - does it do something new? Name the thing this deck currently cannot
do that the added card lets it do. If the added card fills the same role as
the card you are cutting, only in a slightly different way, that is churn.
Swapping one three-mana removal spell for another three-mana removal spell is
not an improvement, it is motion. Cut it from your list.

TEST 2 - does it fight the deck's engine? Read the added card against what
this commander actually does, not against what looks strong in isolation. A
card that disrupts the deck's own machinery is a DOWNGRADE however powerful
it reads. If the deck wins by recurring creatures out of the graveyard, a
card that exiles those creatures works against it. If the deck wins by
keeping a wide board, a card that sacrifices it works against it. Ask the
same question about the card you are cutting, in reverse: a card that looks
weak in isolation may be doing something essential with this commander
specifically. Do not cut it just because its stat line is small.
- If the pool is marked OWNED ONLY, the player is building from cards they
  physically have. Everything you propose must come from that pool - there
  is no "but you should buy" suggestion.`;

export interface RefineCard {
  name: string;
  oracleId: string;
  qty: number;
}

export interface RefineRequest {
  deckId: string;
  commander: string;
  cards: RefineCard[];
  /** Engine-supplied candidates — the ONLY cards the model may propose. */
  pool: RefineCard[];
  /** True when generation was constrained to the player's collection. */
  ownedOnly: boolean;
  analysis: Record<string, unknown>;
}

export const MAX_CARDS = 260;
export const MAX_POOL = 300;
export const MAX_ANALYSIS_JSON_BYTES = 64 * 1024;

function parseCardList(
  value: unknown,
  max: number,
  label: string
): { ok: true; value: RefineCard[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: false, error: `${label} is required.` };
  if (value.length > max) {
    return { ok: false, error: `${label} must have at most ${max} entries.` };
  }
  const cards: RefineCard[] = [];
  for (const c of value) {
    if (typeof c !== 'object' || c === null) return { ok: false, error: `Invalid ${label} entry.` };
    const { name, oracleId, qty } = c as Record<string, unknown>;
    if (typeof name !== 'string' || !name.trim() || name.length > 200) {
      return { ok: false, error: `Invalid ${label} card name.` };
    }
    if (typeof oracleId !== 'string' || oracleId.length > 64) {
      return { ok: false, error: `Invalid ${label} card oracleId.` };
    }
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1 || qty > 99) {
      return { ok: false, error: `Invalid ${label} card qty.` };
    }
    cards.push({ name: name.trim(), oracleId, qty });
  }
  return { ok: true, value: cards };
}

/** Validate an untrusted body into a RefineRequest, or return an error string. */
export function parseRefineRequest(
  body: unknown
): { ok: true; value: RefineRequest } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) return { ok: false, error: 'Body required.' };
  const b = body as Record<string, unknown>;
  if (typeof b.deckId !== 'string' || !b.deckId) return { ok: false, error: 'deckId is required.' };
  if (typeof b.commander !== 'string' || !b.commander.trim()) {
    return { ok: false, error: 'commander is required.' };
  }
  const cards = parseCardList(b.cards, MAX_CARDS, 'cards');
  if (!cards.ok) return cards;
  if (cards.value.length === 0) return { ok: false, error: 'cards is required.' };
  const pool = parseCardList(b.pool, MAX_POOL, 'pool');
  if (!pool.ok) return pool;
  if (typeof b.analysis !== 'object' || b.analysis === null || Array.isArray(b.analysis)) {
    return { ok: false, error: 'analysis is required.' };
  }
  if (JSON.stringify(b.analysis).length > MAX_ANALYSIS_JSON_BYTES) {
    return { ok: false, error: 'analysis is too large.' };
  }
  return {
    ok: true,
    value: {
      deckId: b.deckId,
      commander: (b.commander as string).trim(),
      cards: cards.value,
      pool: pool.value,
      ownedOnly: b.ownedOnly === true,
      analysis: b.analysis as Record<string, unknown>,
    },
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Cache key AND staleness signal, same contract as the review's. The pool is
 * part of it: the same deck offered a different pool is a different question,
 * and must not serve the old answer.
 */
export function hashRefineInput(req: RefineRequest): string {
  const byName = (a: RefineCard, b: RefineCard) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  return crypto
    .createHash('sha256')
    .update(
      stableStringify({
        commander: req.commander,
        cards: [...req.cards].sort(byName),
        pool: [...req.pool].sort(byName).map((c) => c.name),
        ownedOnly: req.ownedOnly,
        analysis: req.analysis,
      })
    )
    .digest('hex');
}

export interface RefineTweak {
  /** Card to add — guaranteed to be a pool member, in the pool's spelling. */
  add: string;
  /** Card to replace — guaranteed to be in the decklist, or null for a pure add. */
  cut: string | null;
  why: string;
}

export interface RefineOutput {
  strategy: string;
  tweaks: RefineTweak[];
  /** Names the model proposed that no pool/decklist entry backs. Audit only. */
  rejected: string[];
}

/**
 * Split the model's reply into streamable prose and verified tweaks.
 *
 * This is the belt to the prompt's braces, and it assumes the model misbehaves:
 * a name that isn't in the pool is DROPPED, not surfaced with a warning, so a
 * hallucinated card can never reach the apply path. Same for a cut that isn't
 * in the deck, a cut of the commander, and a duplicate add. Malformed JSON
 * costs the tweaks, never the prose — a reply whose tail didn't parse is still
 * a readable strategy read.
 */
export function parseRefineOutput(
  raw: string,
  req: Pick<RefineRequest, 'commander' | 'cards' | 'pool'>
): RefineOutput {
  const idx = raw.indexOf(TWEAKS_DELIMITER);
  const strategy = (idx === -1 ? raw : raw.slice(0, idx)).trim();
  const rejected: string[] = [];
  if (idx === -1) return { strategy, tweaks: [], rejected };

  const tail = raw.slice(idx + TWEAKS_DELIMITER.length).trim();
  // The model occasionally wraps the array in a code fence; take the array.
  const start = tail.indexOf('[');
  const end = tail.lastIndexOf(']');
  if (start === -1 || end <= start) return { strategy, tweaks: [], rejected };

  let parsed: unknown;
  try {
    parsed = JSON.parse(tail.slice(start, end + 1));
  } catch {
    return { strategy, tweaks: [], rejected };
  }
  if (!Array.isArray(parsed)) return { strategy, tweaks: [], rejected };

  // Lowercase → canonical spelling, so a case slip still resolves but an
  // invented name can't.
  const poolByName = new Map(req.pool.map((c) => [c.name.toLowerCase(), c.name]));
  const deckByName = new Map(req.cards.map((c) => [c.name.toLowerCase(), c.name]));
  const commander = req.commander.toLowerCase();

  const tweaks: RefineTweak[] = [];
  const usedAdds = new Set<string>();
  const usedCuts = new Set<string>();

  for (const entry of parsed) {
    if (tweaks.length >= MAX_TWEAKS) break;
    if (typeof entry !== 'object' || entry === null) continue;
    const { add, cut, why } = entry as Record<string, unknown>;
    if (typeof add !== 'string' || typeof why !== 'string' || !why.trim()) continue;

    const addName = poolByName.get(add.trim().toLowerCase());
    if (!addName) {
      rejected.push(add.trim());
      continue;
    }
    // Proposing a card the deck already runs, or the same card twice, is a
    // no-op dressed as a change.
    if (usedAdds.has(addName) || deckByName.has(addName.toLowerCase())) continue;

    let cutName: string | null = null;
    if (typeof cut === 'string' && cut.trim()) {
      const lower = cut.trim().toLowerCase();
      // Cutting the commander is never a legal change in this format.
      if (lower === commander) continue;
      cutName = deckByName.get(lower) ?? null;
      if (!cutName) {
        rejected.push(cut.trim());
        continue;
      }
      // One card can't be cut for two different adds.
      if (usedCuts.has(cutName)) continue;
      usedCuts.add(cutName);
    }

    usedAdds.add(addName);
    tweaks.push({ add: addName, cut: cutName, why: why.trim() });
  }

  return { strategy, tweaks, rejected };
}

/** Assemble the user message: decklist + stats + the pool the model may use. */
export function buildRefineMessage(req: RefineRequest, oracle: OracleEntry[]): string {
  const decklist = req.cards.map((c) => `${c.qty} ${c.name}`).join('\n');
  const poolHeader = req.ownedOnly
    ? '## CANDIDATE POOL — OWNED ONLY (the player physically owns every card here)'
    : '## CANDIDATE POOL (the only cards you may propose)';
  const parts = [
    `Commander: ${req.commander}`,
    `## Decklist (${req.cards.reduce((n, c) => n + c.qty, 0)})\n\n${decklist}`,
    `## Statistics\n\n${renderAnalysis(req.analysis)}`,
    `${poolHeader}\n\n${
      req.pool.length > 0 ? req.pool.map((c) => c.name).join('\n') : '(empty — propose nothing)'
    }`,
  ];
  if (oracle.length > 0) {
    const ref = oracle
      .map((o) => {
        const head = [o.name, o.manaCost, o.typeLine ? `— ${o.typeLine}` : '']
          .filter(Boolean)
          .join(' ');
        return o.oracleText ? `${head}: ${o.oracleText.replace(/\n/g, ' ')}` : head;
      })
      .join('\n');
    parts.push(
      `## Card reference (oracle text from the app's card database; may be incomplete)\n\n${ref}`
    );
  }
  return parts.join('\n\n');
}
