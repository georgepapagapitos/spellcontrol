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
    // a creature token (e.g. "create a 1/1 … token"). A *Vehicle* token with a
    // P/T (Mu Yanling, The Bus Runner) is NOT a go-wide creature — it's an
    // artifact until crewed — so it must not read as a tokens-axis producer.
    if (
      !/creature token/.test(after) &&
      !nc &&
      /\d+\/\d+/.test(after) &&
      !/\bvehicle\b/.test(after)
    ) {
      creaturesForYou = true;
      kinds.add('creature');
    }
    // Copy tokens — "create a token that's a copy of …" (Kiki-Jiki, Helm of the
    // Host, Rite of Replication) carry no P/T or "creature token" wording but are
    // go-wide creature producers. The opponent-subject guard above still applies
    // (Fractured Identity's "each player other than its controller creates"). A
    // copy of an ARTIFACT (Osgir, Saheeli's Artistry) is NOT a creature — the
    // artifacts axis handles those — so don't tag a creature token for it.
    if (
      /tokens? that(?:'s| are)(?: a)? cop/.test(after) &&
      !/cop(?:y|ies) of (?:target |that |the )?(?:a )?(?:nonland permanent|artifact)/.test(after)
    ) {
      creaturesForYou = true;
      kinds.add('creature');
    }
  }
  return { creaturesForYou, noncreatureForYou, kinds: [...kinds] };
}

// ── Sacrifice, with outlet vs. reward detection ──────────────────────────────

export interface SacrificeSignals {
  /** A sac OUTLET you control — imperative "Sacrifice a creature" that feeds payoffs. */
  outlet: boolean;
  /** Rewards a sacrifice happening ("Whenever you sacrifice …") — a payoff, not an outlet. */
  rewards: boolean;
}

const SAC_OUTLET_RE =
  /sacrifice (?:a|an|another|one or more|two|three|x) (?:other )?(?:creatures?|permanents?|artifacts?|tokens?)/;
// "Whenever you/a player/another … sacrifices" — a sacrifice payoff. Deliberately
// NOT the bare "whenever an opponent sacrifices" (Tergrid), which is a punisher
// keyed on opponents, not your aristocrats engine.
const SAC_REWARD_RE =
  /whenever (?:you|a player|another)[^.]*\bsacrifices?\b|whenever[^.]*\bis sacrificed\b/;

/**
 * Separate a sac OUTLET (imperative "Sacrifice a creature" you activate) from a
 * payoff that triggers when a sacrifice happens ("Whenever you sacrifice …").
 * Mirrors `discardSignals`: a "Whenever you sacrifice" trigger is a payoff and
 * must not be mistaken for an outlet (Prowling Geistcatcher, Smothering Abomination).
 */
export function sacrificeSignals(oracle: string): SacrificeSignals {
  let outlet = false;
  let rewards = false;
  for (const clause of splitClauses(oracle)) {
    if (SAC_REWARD_RE.test(clause)) {
      rewards = true;
      continue;
    }
    if (SAC_OUTLET_RE.test(clause)) outlet = true;
  }
  return { outlet, rewards };
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

// ── Discard, with subject + trigger detection ───────────────────────────────

export interface DiscardSignals {
  /** Causes cards to be discarded — your own loot/rummage OR forced opponent discard. */
  causes: boolean;
  /** The causation targets opponents ("target player/each opponent discards") — hand attack. */
  forced: boolean;
  /** Rewards a discard *happening* (a triggered ability keyed on discarding). */
  rewards: boolean;
  /** That reward keys off *opponents* discarding (Megrim / Waste Not punishers). */
  rewardsOpponents: boolean;
}

// "Each opponent / target player … discards" — a forced-discard (hand-attack)
// engine. Deliberately excludes (a) the bare "an opponent discards" TRIGGER form
// ("Whenever an opponent discards …"), a payoff handled below, and (b) the
// SYMMETRIC "each player … discards" wheel (Geier Reach Sanitarium), which is
// group draw, not a hand-attack you build around — that reads as `grouphug`.
const FORCED_DISCARD =
  /\b(?:target player|target opponent|each opponent|that player|they)\b[^.]*\bdiscards?\b/;
// Imperative "Discard a card" — a cost or one-shot loot/rummage that fuels you.
const SELF_DISCARD_IMPERATIVE = /\bdiscard (?:a|an|two|three|four|your|that|x|\d+|cards?)\b/;
// Triggered abilities keyed on a discard — these are payoffs, never producers.
const DISCARD_TRIGGER_OPPONENT =
  /whenever (?:a|an|each|another)?\s*(?:opponent|player)s?\b[^.]*\bdiscards?\b/;
const DISCARD_TRIGGER_SELF = /whenever you (?:cycle or )?discards?\b|\bif you discards?\b/;

/**
 * Classify a card's relationship to discarding, distinguishing the engine that
 * *causes* discards (your loot/rummage or forced opponent discard) from the
 * payoff that *rewards* a discard. Mirrors `tokenCreation`'s subject awareness:
 * forced opponent discard (Mind Rot, Tergrid's Lantern) is a deliberate enabler,
 * whereas a "Whenever … discards" trigger (Megrim, Bone Miser) is a payoff — so a
 * card that only triggers on discards is never mistaken for one that makes them.
 */
export function discardSignals(oracle: string): DiscardSignals {
  let causes = false;
  let forced = false;
  let rewards = false;
  let rewardsOpponents = false;
  for (const clause of splitClauses(oracle)) {
    // Triggers win the clause: "Whenever you discard a card, …" is a payoff, not
    // an instruction to discard — checking it first stops the imperative regex
    // from also tagging the same clause as a producer.
    if (DISCARD_TRIGGER_OPPONENT.test(clause)) {
      rewards = true;
      rewardsOpponents = true;
      continue;
    }
    if (DISCARD_TRIGGER_SELF.test(clause)) {
      rewards = true;
      continue;
    }
    if (FORCED_DISCARD.test(clause)) {
      causes = true;
      forced = true;
      continue;
    }
    if (SELF_DISCARD_IMPERATIVE.test(clause)) causes = true;
  }
  return { causes, forced, rewards, rewardsOpponents };
}

// ── Mill, with subject detection (self-mill ≠ opponent mill) ─────────────────

export interface MillSignals {
  /** You mill your OWN library — that fills your graveyard (the `graveyard` axis). */
  selfMill: boolean;
  /** You mill OPPONENTS — a deck-out / attrition plan (the `mill` axis). */
  opponentMill: boolean;
  /** Amplifies milling ("mill twice that many") — a mill payoff. */
  doubler: boolean;
}

// Subject-aware opponent mill. "Target player mills" can hit yourself, but as a
// strategy signal it reads as the deck-out plan; the symmetric/self cases below
// stay with the graveyard axis. Excludes nothing by `you` here because the
// clause loop checks opponent subjects first and self-mill second.
const OPPONENT_MILL =
  /\b(?:target opponent|each opponent|target player|that player|an opponent|opponents|enchanted player|defending player)\b[^.]*\bmills?\b/;
// Pre-"mill"-keyword templating: "<opponent> … puts those cards into their
// graveyard" (Mind Funeral, Mind Grind, Consuming Aberration). Paired in the loop
// with a reveal/library check (order-independent) so it can't catch
// discard-to-graveyard, which references the hand, not the library.
const OPPONENT_REVEAL_MILL =
  /\b(?:target opponent|each opponent|target player|that player|defending player|they)\b[^.]*\bputs?\b[^.]*into (?:their|his or her) graveyard/;
const MILL_DOUBLER = /mill (?:twice that many|that many cards plus)|they mill twice that many/;

/**
 * Classify milling by subject. Self-mill (Stitcher's Supplier, World Shaper) is
 * graveyard-fuel and belongs to the `graveyard` axis; opponent mill (Glimpse the
 * Unthinkable, Bruvac) is a deck-out plan and belongs to the `mill` axis. The old
 * bare `/\bmills?\b/` graveyard predicate conflated the two — every opponent-mill
 * card wrongly read as "fills your graveyard". This is the fix.
 */
export function millSignals(oracle: string): MillSignals {
  let selfMill = false;
  let opponentMill = false;
  const doubler = MILL_DOUBLER.test(oracle);
  for (const clause of splitClauses(oracle)) {
    if (
      OPPONENT_MILL.test(clause) ||
      (OPPONENT_REVEAL_MILL.test(clause) && /reveal|library/.test(clause))
    ) {
      opponentMill = true;
      continue;
    }
    // Subjectless "mill three cards" / "you (may) mill" = you mill yourself.
    // Self-mill commonly spells the number out ("mill three cards"), so accept a
    // word before "card(s)" too, not just digits.
    if (/\byou (?:may )?mill\b/.test(clause) || /\bmill (?:\w+ )?cards?\b/.test(clause))
      selfMill = true;
  }
  return { selfMill, opponentMill, doubler };
}

// ── Creature-death payoff, excluding opponent-only triggers ──────────────────

/**
 * True when the card rewards YOUR creatures dying (aristocrats). Excludes
 * triggers that fire ONLY on opponents' creatures dying (Massacre Wurm, Yahenni)
 * — those are removal/attrition punishers, not your sacrifice engine — unless the
 * same clause also covers creatures you control (Death Tyrant). Same-clause
 * scoping also tightens the old oracle-wide "creature mentioned anywhere" branch.
 */
export function paysOffCreatureDeath(oracle: string): boolean {
  for (const clause of splitClauses(oracle)) {
    if (!/\bdies\b/.test(clause) || !/\bcreature/.test(clause)) continue;
    if (!/\bwhenever\b/.test(clause)) continue;
    const opponentOnly =
      /creatures? an opponent controls? dies|creatures? your opponents control[^.]*dies/.test(
        clause
      ) && !/you control[^.]*dies|dies[^.]*you control/.test(clause);
    if (opponentOnly) continue;
    return true;
  }
  return false;
}
