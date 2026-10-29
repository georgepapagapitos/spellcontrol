// Board-wipe reading from oracle text (E109/E112/E1002), moved out of client.ts so that file
// stays under its size limit. client.ts re-exports all of it.

// One-sided (asymmetric) board wipes (E109) — same shape again: a pure
// oracle-text predicate. A symmetric wipe (the boardwipe role's common case)
// hits every player equally; a one-sided wipe spares the caster's own board.
// Two branches, each verified against real Scryfall oracle text:
//  - "you don't control" scope — Plague Wind ("Destroy all creatures you
//    don't control. They can't be regenerated."), In Garruk's Wake ("Destroy
//    all creatures you don't control and all planeswalkers you don't
//    control.").
//  - "your opponent(s) control" scope — Ruinous Ultimatum ("Destroy all
//    nonland permanents your opponents control.").
// Both branches require the scope clause to land in the SAME sentence as the
// sweep verb ([^.]*? stops at a period — the codebase's own documented FP
// hazard for a scope clause that could otherwise span into an unrelated
// later sentence).
//
// False-positive guard, verified against real Scryfall oracle text for every
// symmetric wipe this slice's build spec named or that's a natural
// boundary-check: Farewell ("Exile all artifacts."/"...creatures."/
// "...enchantments."/"...graveyards.", no qualifier), Blasphemous Act
// ("deals 13 damage to each creature", no destroy/exile verb at all), Wrath
// of God/Damnation ("Destroy all creatures.", no qualifier), Toxic Deluge
// ("-X/-X", no verb), Crux of Fate/Vanquish the Horde ("Destroy all
// [non-]Dragon creatures."/"Destroy all creatures.", no qualifier), Austere
// Command (four "destroy all X" modes, none ever scoped to an opponent),
// Extinction Event ("Exile each creature with mana value...", no qualifier
// and no literal "all") — none contain either scope clause, so none trip
// this. Single Combat ("Each player chooses a creature or planeswalker they
// control, then sacrifices the rest.") uses neither the destroy/exile verb
// nor either scope clause — it's genuinely symmetric (every player,
// including the caster, loses down to one); this corrects an assumption in
// this slice's own build spec, which grouped it with the one-sided cards
// from memory rather than the real printed text.
//
// E112 fix-round: the "known accepted miss" this slice originally shipped
// with (Cyclonic Rift's Overload mode) is now closed by a third branch —
// E112's own scope-collateral selection made the gap actively harmful
// (Vandalblast overloaded, same shape, started losing pick-time comparisons
// to a genuinely-worse symmetric wipe because it read as "symmetric" here
// while only scoring a small nonzero collateral penalty in
// wipeScopeCollateralTieBreak — a bogus tie that let raw priority/false
// symmetry pick the wrong wipe). Overload rewrites "target" to "each" via a
// RULES INSTRUCTION in the reminder text (never literally in the effect
// line), so the base "target ... you don't control" clause plus a
// co-occurring "overload" keyword is the same one-sidedness evidence as the
// literal "all ... you don't control" branches above, just pre-rewrite.
// Verified against real oracle text: Vandalblast ("Destroy target artifact
// you don't control.\nOverload {4}{R}...") and Cyclonic Rift ("Return target
// nonland permanent you don't control to its owner's hand.\nOverload
// {6}{U}..."). Requires the "you don't control" qualifier in the SAME
// sentence as the target clause (not just a bare "overload" anywhere in the
// text) — Damn's overloaded mode ("Destroy target creature. ... Overload
// {2}{W}{W}") has no "don't control" qualifier at all and correctly stays
// symmetric (its overloaded "destroy each creature" hits every player,
// including the caster).
//
// E136 gate-found fix: DAMAGE-based one-sided wipes were invisible — every
// branch above keys on destroy/exile(/overloaded-return), so Goblin
// Chainwhirler (real text: "it deals 1 damage to each opponent and each
// creature and planeswalker they control") read as symmetric, which both
// mis-scored it in E112's wipe-quality eviction AND dropped the
// wipeAsymmetryNote's "spares your own board" clause when it was a deck's
// sole wipe (caught by the E136 ship-gate differ on krenko-budget50). Two
// verified phrasings, both same-sentence bounded with an opponent subject:
// the anaphoric modern template ("each opponent and each creature ... they
// control" — Chainwhirler) and the direct qualifier ("each creature your
// opponents control" / "you don't control"). Blasphemous Act ("deals 13
// damage to each creature" — no opponent subject anywhere) correctly stays
// symmetric.
//
// E1046 gate-found fix: SHRINK-based one-sided wipes read symmetric too, so
// budget convergence traded Silumgar, the Drifting Death ("creatures
// defending player controls get -1/-1") for Deathbringer Regent ("destroy all
// other creatures") in a Dragon deck as an even wipe swap. Verified phrasings:
// "creatures your opponents control get -2/-2" (Massacre Wurm, Cower in Fear,
// Elesh Norn, Grand Cenobite) and "creatures defending player controls get
// -1/-1" (Silumgar). Shrivel and Toxic Deluge ("All creatures get"), Crippling
// Fear and Witch's Vengeance (a chosen type, every player) stay symmetric.
// The same gate's standard Ur-Dragon then took Silumgar over Balefire Dragon,
// whose combat-damage sweep ("deals that much damage to each creature that
// player controls") hits only the player it damaged, so that reads one-sided
// as well.
const ONE_SIDED_WIPE_EVIDENCE =
  /\bcreatures (?:your opponents?|defending player) controls? get -|deals combat damage to a player,[^.]*?\beach creature that player controls|\b(?:destroy|exile)\b[^.]*?\ball\b[^.]*?you don'?t control|\b(?:destroy|exile)\b[^.]*?\ball\b[^.]*?your opponents? control|(?=[\s\S]*\boverload\b)(?=[\s\S]*\b(?:destroy|exile|return) target [^.]*?you don'?t control\b)|deals? [^.]*?damage to [^.]*?each opponent[^.]*?\b(?:creatures?|planeswalkers?|permanents?)\b[^.]*?they control|deals? [^.]*?damage to [^.]*?each (?:creature|permanent)s?\b[^.]*?(?:your opponents? control|you don'?t control)/i;

export function isOneSidedWipe(card: {
  name: string;
  oracle_text?: string;
  card_faces?: Array<{ oracle_text?: string }>;
}): boolean {
  const text = (
    card.oracle_text ??
    card.card_faces?.map((f) => f.oracle_text ?? '').join(' ') ??
    ''
  ).trim();
  if (!text) return false;
  return ONE_SIDED_WIPE_EVIDENCE.test(text);
}

// Which permanent types a board wipe destroys/exiles (E112) — a SEPARATE
// axis from isOneSidedWipe above (who it hits) and getBoardwipeSubtype (a
// tagger-tag lookup, not oracle text). Creatures are expected collateral for
// almost every wipe — that's what a wrath is FOR — the mismatch that
// actually hurts a deck's own plan is a wipe that ALSO destroys/exiles the
// non-creature type the deck is heavy in (an enchantress deck's own
// Farewell, an artifact deck's own Vandalblast-overloaded board). Each field
// is verified against real Scryfall oracle text:
//  - Wrath of God / Damnation ("Destroy all creatures. They can't be
//    regenerated."), Toxic Deluge ("All creatures get -X/-X..."),
//    Blasphemous Act ("...deals 13 damage to each creature."): creatures
//    only — none of artifacts/enchantments/planeswalkers/all trip.
//  - Farewell ("Exile all creatures. ... Exile all artifacts and
//    enchantments. Exile all graveyards.") and Austere Command ("Destroy
//    all artifacts."/"...enchantments."/"...creatures with power 3 or
//    greater."/"...power 2 or less."): creatures + artifacts + enchantments
//    (modal — choose one/two of these clauses, but the printed card CAN nuke
//    any of them, so scope is the union of its modes).
//  - Vandalblast overloaded ("Destroy target artifact you don't control.
//    Overload {4}{R}...") and Cyclonic Rift overloaded ("Return target
//    nonland permanent you don't control... Overload {6}{U}..."): both now
//    read as one-sided (isOneSidedWipe's own overload+"you don't control"
//    branch — E112 fix-round) and so short-circuit to the empty scope below,
//    never reaching WIPE_SCOPE_ARTIFACTS/WIPE_SCOPE_ALL's own overload
//    branches at all. Those two branches stay for the narrower case they
//    were built for — a hypothetical SYMMETRIC overloaded wipe (an
//    overloaded "destroy/return target artifact"/"target nonland permanent"
//    with no "you don't control" qualifier, so its overloaded mode hits
//    every player's copies, not just an opponent's) — no such real card is
//    in this slice's ground truth, so this is a documented, currently-
//    unexercised-by-name defensive branch, not dead code.
//
// A one-sided wipe (isOneSidedWipe) spares the caster's own board by
// construction, so it always returns the empty/no-collateral scope
// regardless of which types it prints — "does this wipe hurt MY board" is
// the only question this classifier's consumers (own-board collateral
// scoring) ever ask, and folding that check in here keeps it a single
// self-contained answer instead of threading a second one-sidedness check
// through every caller.
export interface WipeScope {
  creatures: boolean;
  artifacts: boolean;
  enchantments: boolean;
  planeswalkers: boolean;
  /** A bare "all/each (nonland) permanent(s)" scope — implies every type,
   *  even where the per-type field above didn't independently trip. */
  all: boolean;
}

const NO_WIPE_SCOPE: WipeScope = {
  creatures: false,
  artifacts: false,
  enchantments: false,
  planeswalkers: false,
  all: false,
};

const WIPE_SCOPE_CREATURES =
  /(?:destroy|exile)\b[^.]*?\ball\b[^.]*?creatures?\b|\ball creatures\b[^.]*?(?:get|take|deal)|each creature (?:gets|takes)|creatures?[^.]*?get -\d+\/-\d+|damage to each creature|(?:destroy|exile) each creature/i;
const WIPE_SCOPE_ARTIFACTS =
  /(?:destroy|exile)\b[^.]*?\ball\b[^.]*?artifacts?\b|(?=[\s\S]*\boverload\b)(?=[\s\S]*\b(?:destroy|exile|return) target artifact\b)/i;
const WIPE_SCOPE_ENCHANTMENTS = /(?:destroy|exile)\b[^.]*?\ball\b[^.]*?enchantments?\b/i;
const WIPE_SCOPE_PLANESWALKERS = /(?:destroy|exile)\b[^.]*?\ball\b[^.]*?planeswalkers?\b/i;
const WIPE_SCOPE_ALL =
  /\ball (?:nonland )?permanents?\b|\beach permanent\b|(?=[\s\S]*\boverload\b)(?=[\s\S]*\b(?:destroy|exile|return) target nonland permanent\b)/i;

// "Permanents that are one or more colors" (All Is Dust, Ugin's -X); "colored
// permanents" for any future printing worded that way.
const WIPE_SCOPE_COLORED_ONLY =
  /\bthat(?:'s| are| is) one or more colors\b|\bone or more colors\b[^.]*\bpermanents?\b|\bcolored (?:nonland )?permanents?\b/i;

/** A sweep of permanents that are one or more colors only (All Is Dust, Ugin's -X). */
export function isColoredOnlyWipe(card: {
  name: string;
  oracle_text?: string;
  card_faces?: Array<{ oracle_text?: string }>;
}): boolean {
  const text = (
    card.oracle_text ??
    card.card_faces?.map((f) => f.oracle_text ?? '').join(' ') ??
    ''
  ).trim();
  return WIPE_SCOPE_ALL.test(text) && WIPE_SCOPE_COLORED_ONLY.test(text);
}

export function getWipeScope(card: {
  name: string;
  oracle_text?: string;
  card_faces?: Array<{ oracle_text?: string }>;
}): WipeScope {
  const text = (
    card.oracle_text ??
    card.card_faces?.map((f) => f.oracle_text ?? '').join(' ') ??
    ''
  ).trim();
  if (!text) return NO_WIPE_SCOPE;
  if (isOneSidedWipe(card)) return NO_WIPE_SCOPE;
  // A sweep of colored permanents only (All Is Dust, Ugin, the Spirit Dragon's -X) spares
  // a colorless artifact, which is nearly every artifact: reading it as "all permanents"
  // billed an Eldrazi artifact deck for collateral it does not take, and All Is Dust
  // (94% of Emrakul's Eldrazi decks) scored as the worst wipe to keep. Enchantments are
  // colored, so those still count.
  if (isColoredOnlyWipe(card)) {
    return {
      creatures: true,
      artifacts: false,
      enchantments: true,
      planeswalkers: true,
      all: false,
    };
  }
  return {
    creatures: WIPE_SCOPE_CREATURES.test(text),
    artifacts: WIPE_SCOPE_ARTIFACTS.test(text),
    enchantments: WIPE_SCOPE_ENCHANTMENTS.test(text),
    planeswalkers: WIPE_SCOPE_PLANESWALKERS.test(text),
    all: WIPE_SCOPE_ALL.test(text),
  };
}
