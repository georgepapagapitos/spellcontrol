import type { RoleKey } from './index';

// Positive-evidence patterns per role (E77 iter-4 sanity layer). A role claim
// from `getCardRole`/a `TagLookup` must be corroborated by the card's own
// oracle text when text is available — follows the `fetchedBasicRequirement`
// precedent (manabaseMath.ts): don't trust a crowd-sourced tag (or a
// corrupt/mismatched Scryfall record) blindly. Generic textual evidence, not
// card-name patches — this is what catches an extra-turns sorcery mistagged
// 'ramp' (Expropriate, which has no mana-production/land-fetch/cost-reduction
// text) and a record whose cached oracle text doesn't match its claimed role
// for any reason.
//
// Shared between the frontend tagger client (`validateCardRole`, which also
// drives live generation picking) and the backend `check_bracket` tool, which
// used to count roles with no evidence gate at all and drifted from the page
// as a result. One copy here so the two can't disagree again.
const ROLE_EVIDENCE: Record<RoleKey, RegExp> = {
  // Land-aura mana boosters phrase this as "adds an additional {G}" (not
  // "add {G}") and variable-mana rocks as "Add X/three/two mana..." or "add
  // an amount of {C}..." — consolidated into one lenient add-then-mana(or
  // brace) pattern (Wild Growth, Utopia Sprawl, Sanctum Weaver, Lion's Eye
  // Diamond, Mana Echoes, Klauth, Sarkhan all previously broke the rigid
  // "add {"/"add one mana" adjacency). Treasure-makers are ramp by deferred
  // mana (Smothering Tithe, Dockside Extortionist, Pitiless Plunderer, Revel
  // in Riches). Cost reduction can be a colored-symbol cost, not just a
  // digit (Morophon: "cost {W}{U}{B}{R}{G} less"). Land-onto-battlefield via
  // exile (not search) is its own idiom (Oblivion Sower).
  //
  // E136 fix (2026-07-23, full-corpus audit — ramp gate-blind 11%): three
  // verified real-card gaps, every one live-checked against Scryfall.
  //  - Land-recursion-to-battlefield literally says "TO the battlefield" in
  //    real Oracle text (Splendid Reclamation: "Return all land cards from
  //    your graveyard to the battlefield tapped."), not just "ONTO the
  //    battlefield" — widened to accept either preposition.
  //  - An untap-lands burst ("untap all lands you control" — Wilderness
  //    Reclamation) is a distinct mana-burst shape with no cost-reduction/
  //    search/treasure text of its own to trip any other branch.
  //  - Convoke/improvise GRANTED to other spells ("Artifact spells you cast
  //    have convoke" — Chief Engineer; "Nonartifact spells you cast have
  //    improvise" — Inspiring Statuary) is a real cost-reduction engine.
  //    Scoped to the granting template ("have"/"has" + convoke/improvise) so
  //    a card that merely HAS convoke/improvise itself as its own printed
  //    keyword (Aerial Boost's bare "Convoke" reminder, no granting clause)
  //    doesn't trip it — that's a one-off cost payment method for THAT card,
  //    not an ongoing ramp engine.
  ramp: /adds?\s+(an additional\s+|an amount of\s+)?(\{|[\w\s]{0,15}?mana\b)|search your library for [^.]*?(land|forest|island|swamp|mountain|plains)[^.]*?battlefield|costs? [^.]*?less( to cast)?|play an additional land|creates? [^.]*?treasures?\b|lands? cards?[^.]*?(?:onto|to) the battlefield|untap[^.]*?lands? you control|\b(?:have|has) (?:convoke|improvise)\b/i,
  // Lenient destroy/exile-target gap ("exile two target permanents", "exile
  // up to one target permanent") alongside direct "destroy target creature".
  // Damage-based removal (burn/reach — Lightning Bolt, Massive Raid,
  // Endbringer) and sacrifice-edicts with any forcing subject (not just
  // "target player" — Vraska's Fall, Fleshbag Marauder, Grave Pact) round out
  // the common removal shapes the raw tag already covers. Threaten effects
  // ("gain control of target creature") and Pacifism/Song-of-the-Dryads-style
  // auras ("loses all abilities") are real, distinct removal templating, not
  // destroy/exile at all.
  //
  // E136 fix (2026-07-23, full-corpus audit — removal gate-blind 26.7%): four
  // verified real-card gaps, every one live-checked against Scryfall.
  //  - Library-tuck: "put target creature on top/bottom of its owner's
  //    library" (Anchor to the Aether) is real removal templating no
  //    destroy/exile/counter/bounce branch catches.
  //  - Fight widened past the exact "fights target creature" adjacency —
  //    real cards insert a word between the verb and the object ("fights
  //    ANOTHER target creature" — Blood Feud; "fights up to one target
  //    creature" — Agatha's Champion); a same-sentence lenient join covers
  //    both without narrowing the original strict form.
  //  - A tap-lock ("doesn't"/"don't untap during its/their controller's
  //    [next] untap step" — Icefall Regent, Frost Breath) is de facto tempo
  //    removal. Anchored to third-person "its"/"their" (never "your") so a
  //    card's OWN self-tap-down cost can't false-positive — Basalt
  //    Monolith's "doesn't untap during YOUR untap step" is a mana rock's
  //    downside, not removal, and correctly stays excluded.
  //  - The sacrifice-edict subject list gains "target opponent" (Tribute to
  //    Hunger: "Target opponent sacrifices a creature of their choice"),
  //    opponent-forcing like the rest of the list.
  removal:
    /(destroy|exile)[^.]*?target|counter target spell|return target (creature|permanent|artifact|enchantment|planeswalker|spell)|fights?[^.]*?target creature|target creature gets? [+-]?\d+\/-\d+|(target player|target opponent|each opponent|defending player|each player|each other player)[^.]*?sacrifice|damage[^.]*?to (target|any target)\b|gain control of target creature|loses all( other card types and)? abilities|put target[^.]*?(?:top|bottom) of its owner'?s library|(?:doesn't|don't) untap during (?:its|their) controller'?s (?:next )?untap step/i,
  // Exile-based wipes (Farewell) and return-all bounce wipes (Devastation
  // Tide) alongside the destroy-based ones. "destroy each"/"exile
  // each"/"return each" (permanent, not just creature — Selective
  // Obliteration, Spectral Deluge) and a lenient "return all" gap ("return
  // all ATTACKING creatures" — Aetherize) cover more wipe verbs. A one-sided
  // "-N/-N to an opponent's board" (Massacre Wurm, Silumgar) and a counter-
  // based wipe (Contagion Engine's "-1/-1 counter on each creature") are
  // distinct real wipe shapes, not just "all"/"each" phrasing. "For each
  // opponent, destroy..." (Ruinous Ultimatum) is a per-opponent one-sided
  // wipe idiom. Overload spells replace "target" with "each" via a rules
  // instruction in the reminder text, not literally in the effect line
  // (Damn, Vandalblast, Cyclonic Rift) — corroborated by the co-occurrence
  // of "overload" with a destroy/exile/return-target clause, regardless of
  // which comes first in the text.
  //
  // E136 fix (2026-07-23, full-corpus audit — boardwipe gate-blind 21%): two
  // verified real-card gaps, both live-checked against Scryfall.
  //  - The damage branch required literal "damage to each creature"
  //    adjacency, missing scoped variants where the object isn't literally
  //    "each creature" right after "to" (Flame Wave: "deals 4 damage to
  //    target player or planeswalker and each creature that player...
  //    controls" — a player-scoped one-sided wipe); widened to a
  //    same-sentence lenient join.
  //  - The -N/-N branch required plural "creatures" and a literal digit,
  //    missing token/type-scoped mass debuffs phrased with a singular noun
  //    (Virulent Plague, current Oracle text: "Creature tokens get -2/-2.")
  //    or an X magnitude. Widened the noun to optional-plural and the
  //    magnitude to digit-or-X while keeping the literal "get -" (not
  //    "gets -") unchanged — that verb-agreement quirk is what already
  //    excluded, and must keep excluding, a single-target spot-removal spell
  //    like Battle at the Bridge ("Target creature gets -X/-X until end of
  //    turn.") from this MASS-wipe branch.
  boardwipe:
    /destroy all|destroy each|exile all|exile each (creature|permanent)|all creatures (get|take|deal)|each creature (gets|takes)|creatures?[^.]*?get -(?:\d+|[Xx])\/-(?:\d+|[Xx])|damage[^.]*?to[^.]*?each creature|return all [^.]*?(creatures|permanents)|return each (creature|permanent)|each player sacrifices (a|all)|(\+1\/\+1|-1\/-1) counters? on each creature|for each opponent[^.]*?destroy|(?=[\s\S]*\boverload\b)(?=[\s\S]*\b(?:destroy|exile|return) target\b)/i,
  // Tutors (search-library-into-ANY-destination, or a card that redirects an
  // OPPONENT's search — Opposition Agent) are folded into cardDraw by
  // getCardRole — the taxonomy call already made, not this gate's job to
  // re-litigate. Real tutors put the found card into hand, onto the
  // battlefield, into the graveyard, or on top of the library (Vampiric
  // Tutor, Demonic Tutor, Entomb, Natural Order, Protean Hulk, ...) — accept
  // any destination rather than requiring "into hand" specifically. Library-
  // top manipulation ("the top N cards of your library", "the top of your
  // library") and graveyard-to-hand recursion are the other two common
  // card-advantage shapes the raw tag covers.
  //
  // E136 fix (2026-07-23, full-corpus audit — cardDraw gate-blind 5.6%,
  // monarch alone was 7/30 of the judged draw misses): three verified
  // real-card gaps, every one live-checked against Scryfall.
  //  - Monarch grant ("you become the monarch" — Palace Jailer) is real
  //    card-advantage no existing branch catches. Kept strictly first-person
  //    by excluding a "whenever" immediately before it — Jared Carthalion,
  //    True Heir grants monarchy to an OPPONENT ("target opponent becomes
  //    the monarch") and separately says "You can't become the monarch this
  //    turn," neither of which is the "you become the monarch" grant, and
  //    correctly never matches.
  //  - Investigate ("investigate" — Duggan, Private Detective) is real
  //    card-advantage frequently printed WITHOUT its Clue-token reminder
  //    text in modern templating, so the existing "draws? a" branch (which
  //    only fires when that reminder happens to be present) misses it
  //    outright. Excluded when the subject investigating is an opponent, not
  //    you — Declaration in Stone's "That player investigates for each
  //    nontoken creature exiled this way" compensates the removed creature's
  //    controller (typically an opponent), not your own card advantage, and
  //    correctly never matches.
  //  - Mass graveyard-to-hand recursion phrased with "put" instead of
  //    "return" (Campfire: "Put all commanders you own from the command
  //    zone and from your graveyard into your hand.") joins the existing
  //    return-based branch.
  cardDraw:
    /draws? (a|two|three|four|x|that many|cards? equal to)|search your library for [^.]*?cards?\b|search(ing|es)? (your|their|its) library|each player draws|whenever [^.]*?draws? a card|top[^.]{0,15}?of (your|their|its) library|(?:return|put)[^.]*?graveyard[^.]*?hand|(?<!whenever )you become the monarch|(?<!player )(?<!opponent )investigate/i,
};

/**
 * Does `oracleText` corroborate the tagger's `role` claim? Returns `role`
 * when it does, `null` when the text contradicts it, and `role` (trusting the
 * tag) when there's no text to check against — can't validate what we can't
 * read, so a face with no text doesn't lose a real role for lack of data.
 */
export function checkRoleEvidence(role: RoleKey, oracleText: string): RoleKey | null {
  const text = oracleText.trim();
  if (!text) return role;
  return ROLE_EVIDENCE[role].test(text) ? role : null;
}
