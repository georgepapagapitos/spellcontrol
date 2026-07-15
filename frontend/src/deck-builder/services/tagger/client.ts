import { logger } from '@/lib/logger';
const TAG_REPO_URL =
  (import.meta.env.VITE_TAG_REPO_URL as string | undefined) ?? '/tagger-tags.json';

export interface TaggerData {
  generatedAt: string;
  tags: Record<string, string[]>;
}

// In-memory cache — lives for the entire session
let cached: TaggerData | null = null;
let fetchPromise: Promise<TaggerData | null> | null = null;

// Precomputed Set lookups for O(1) card-name checks
let tagSets: Record<string, Set<string>> | null = null;

/**
 * Fetch tagger data from S3 (or return cached).
 * Safe to call multiple times — deduplicates in-flight requests.
 */
export async function loadTaggerData(): Promise<TaggerData | null> {
  if (cached) return cached;
  if (fetchPromise) return fetchPromise;
  if (!TAG_REPO_URL) {
    logger.warn('[Tagger] No VITE_TAG_REPO_URL configured, skipping tagger data');
    return null;
  }

  fetchPromise = (async () => {
    try {
      const res = await fetch(TAG_REPO_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: TaggerData = await res.json();
      cached = data;
      // Build Set lookups
      tagSets = {};
      for (const [tag, names] of Object.entries(data.tags)) {
        tagSets[tag] = new Set(names);
      }
      const tagSummary = Object.entries(data.tags)
        .map(([k, v]) => `${k}:${v.length}`)
        .join(', ');
      logger.debug(
        `[Tagger] Loaded ${Object.keys(data.tags).length} tags (generated ${data.generatedAt}): ${tagSummary}`
      );
      // The build-time refresh script (scripts/refresh-tagger.mjs) re-fetches
      // when local data is >30d old; 60d at runtime means either the build
      // pipeline hasn't run in a month or the S3 fetch was failing through
      // multiple builds. Either way it's worth surfacing.
      const ageDays = (Date.now() - new Date(data.generatedAt).getTime()) / 86_400_000;
      if (Number.isFinite(ageDays) && ageDays > 60) {
        logger.warn(
          `[Tagger] Data is ${ageDays.toFixed(0)} days old (generated ${data.generatedAt}); role/tag detection may be drifting from upstream`
        );
      }
      return data;
    } catch (err) {
      logger.warn('[Tagger] Failed to load tagger data — role detection will be unavailable:', err);
      return null;
    } finally {
      fetchPromise = null;
    }
  })();

  return fetchPromise;
}

/** Check if a card has a specific tagger tag. Returns false if tagger data isn't loaded. */
export function hasTag(cardName: string, tag: string): boolean {
  return tagSets?.[tag]?.has(cardName) ?? false;
}

/**
 * All tagger tags a card carries (e.g. ['mana-rock', 'ramp']). Used as a
 * functional fingerprint for card-similarity (Jaccard overlap). Empty when
 * tagger data isn't loaded. O(#tags) — there are ~two dozen tags, so cheap.
 */
export function getCardTags(cardName: string): string[] {
  if (!tagSets) return [];
  const out: string[] = [];
  for (const tag in tagSets) if (tagSets[tag].has(cardName)) out.push(tag);
  return out;
}

/** Check if tagger data is available */
export function hasTaggerData(): boolean {
  return tagSets !== null;
}

/** Check if a land has meaningful non-mana abilities (Scryfall otag:utility-land). */
export function isUtilityLand(cardName: string): boolean {
  return tagSets?.['utility-land']?.has(cardName) ?? false;
}

/** Check if a land enters the battlefield tapped (Scryfall otag:tapland). */
export function isTapland(cardName: string): boolean {
  return tagSets?.['tapland']?.has(cardName) ?? false;
}

/** Check if a card denies mass land resources — Armageddon, Winter Orb, Blood Moon, etc. (Scryfall otag:mass-land-denial). */
export function isMassLandDenial(cardName: string): boolean {
  return tagSets?.['mass-land-denial']?.has(cardName) ?? false;
}

/** Check if a card grants extra turns — Time Warp, Expropriate, etc. (Scryfall otag:extra-turn). */
export function isExtraTurn(cardName: string): boolean {
  return tagSets?.['extra-turn']?.has(cardName) ?? false;
}

export type RoleKey = 'ramp' | 'removal' | 'boardwipe' | 'cardDraw';
export type RampSubtype = 'mana-producer' | 'mana-rock' | 'cost-reducer' | 'ramp';
export type RemovalSubtype = 'counterspell' | 'bounce' | 'spot-removal' | 'removal';
export type BoardwipeSubtype = 'bounce-wipe' | 'boardwipe';
export type CardDrawSubtype = 'tutor' | 'wheel' | 'cantrip' | 'card-draw' | 'card-advantage';

// ── Private role-membership predicates ──────────────────────────────────────
// These consolidate the repeated tag-set checks used by getCardRole,
// cardMatchesRole, hasMultipleRoles, and getAllCardRoles.

function isRampCard(cardName: string): boolean {
  return !!(
    tagSets?.['ramp']?.has(cardName) ||
    tagSets?.['cost-reducer']?.has(cardName) ||
    tagSets?.['mana-dork']?.has(cardName) ||
    tagSets?.['mana-rock']?.has(cardName)
  );
}

function isCardDrawCard(cardName: string): boolean {
  return !!(
    tagSets?.['card-advantage']?.has(cardName) ||
    tagSets?.['tutor']?.has(cardName) ||
    tagSets?.['draw']?.has(cardName) ||
    tagSets?.['wheel']?.has(cardName) ||
    tagSets?.['looting']?.has(cardName) ||
    tagSets?.['cantrip']?.has(cardName)
  );
}

/** Categorize a card by its tagger tags. Returns the best-fit deck role, or null if no tag matches / data unavailable. */
export function getCardRole(cardName: string): RoleKey | null {
  if (!tagSets) return null;
  // Check in priority order — boardwipe before removal (it's more specific)
  if (tagSets['boardwipe']?.has(cardName)) return 'boardwipe';
  if (tagSets['removal']?.has(cardName)) return 'removal';
  if (isRampCard(cardName)) return 'ramp';
  if (isCardDrawCard(cardName)) return 'cardDraw';
  return null;
}

/**
 * Role label for cube generation. `getCardRole` folds cost-reducers into `ramp`
 * (they cut spell costs, not produce mana) — in a cube that reads as mana
 * acceleration a drafter won't actually get (Puresteel Paladin, Starfield
 * Mystic, Cloud Key…). Demote cost-reducer-only "ramp" to no role so the card
 * falls back to its curve descriptor instead of a misleading one. (Real ramp —
 * mana dorks/rocks and the raw `ramp` tag — is unaffected.)
 */
export function cubeRole(cardName: string): RoleKey | null {
  const r = getCardRole(cardName);
  if (r === 'ramp' && getRampSubtype(cardName) === 'cost-reducer') return null;
  return r;
}

/** Check if a card matches a specific role (regardless of priority). */
export function cardMatchesRole(cardName: string, role: RoleKey): boolean {
  if (!tagSets) return false;
  switch (role) {
    case 'boardwipe':
      return !!tagSets['boardwipe']?.has(cardName);
    case 'removal':
      return !!tagSets['removal']?.has(cardName);
    case 'ramp':
      return isRampCard(cardName);
    case 'cardDraw':
      return isCardDrawCard(cardName);
    default:
      return false;
  }
}

/** Check if a card matches more than one role category. */
export function hasMultipleRoles(cardName: string): boolean {
  if (!tagSets) return false;
  let count = 0;
  if (tagSets['boardwipe']?.has(cardName) || tagSets['removal']?.has(cardName)) count++;
  if (isRampCard(cardName)) count++;
  if (isCardDrawCard(cardName)) count++;
  return count > 1;
}

/** Get ALL roles a card matches (not just the primary one). */
export function getAllCardRoles(cardName: string): RoleKey[] {
  if (!tagSets) return [];
  const roles: RoleKey[] = [];
  if (tagSets['boardwipe']?.has(cardName)) roles.push('boardwipe');
  if (tagSets['removal']?.has(cardName)) roles.push('removal');
  if (isRampCard(cardName)) roles.push('ramp');
  if (isCardDrawCard(cardName)) roles.push('cardDraw');
  return roles;
}

/** For cards with the 'ramp' role, return the specific subtype. */
export function getRampSubtype(cardName: string): RampSubtype | null {
  if (!tagSets) return null;
  if (tagSets['mana-dork']?.has(cardName)) return 'mana-producer';
  if (tagSets['mana-rock']?.has(cardName)) return 'mana-rock';
  if (tagSets['cost-reducer']?.has(cardName)) return 'cost-reducer';
  if (tagSets['ramp']?.has(cardName)) return 'ramp';
  return null;
}

/** For cards with the 'removal' role, return the specific subtype. */
export function getRemovalSubtype(cardName: string): RemovalSubtype | null {
  if (!tagSets) return null;
  if (tagSets['counterspell']?.has(cardName)) return 'counterspell';
  if (tagSets['bounce']?.has(cardName)) return 'bounce';
  if (tagSets['spot-removal']?.has(cardName)) return 'spot-removal';
  if (tagSets['removal']?.has(cardName)) return 'removal';
  return null;
}

/** For cards with the 'boardwipe' role, return the specific subtype via cross-referencing. */
export function getBoardwipeSubtype(cardName: string): BoardwipeSubtype | null {
  if (!tagSets) return null;
  if (!tagSets['boardwipe']?.has(cardName)) return null;
  if (tagSets['bounce']?.has(cardName)) return 'bounce-wipe';
  return 'boardwipe';
}

/** For cards with the 'cardDraw' role, return the specific subtype. */
export function getCardDrawSubtype(cardName: string): CardDrawSubtype | null {
  if (!tagSets) return null;
  if (tagSets['tutor']?.has(cardName)) return 'tutor';
  if (tagSets['wheel']?.has(cardName)) return 'wheel';
  if (tagSets['cantrip']?.has(cardName)) return 'cantrip';
  if (tagSets['draw']?.has(cardName)) return 'card-draw';
  return 'card-advantage';
}

// Positive-evidence patterns per role (E77 iter-4 sanity layer). A role claim
// from `getCardRole` must be corroborated by the card's own oracle text when
// text is available — follows the `fetchedBasicRequirement` precedent
// (manabaseMath.ts): don't trust a crowd-sourced tag (or a corrupt/mismatched
// Scryfall record) blindly. Generic textual evidence, not card-name patches —
// this is what catches an extra-turns sorcery mistagged 'ramp' (Expropriate,
// which has no mana-production/land-fetch/cost-reduction text) and a record
// whose cached oracle text doesn't match its claimed role for any reason.
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
  ramp: /adds?\s+(an additional\s+|an amount of\s+)?(\{|[\w\s]{0,15}?mana\b)|search your library for [^.]*?(land|forest|island|swamp|mountain|plains)[^.]*?battlefield|costs? [^.]*?less( to cast)?|play an additional land|creates? [^.]*?treasures?\b|lands? cards?[^.]*?onto the battlefield/i,
  // Lenient destroy/exile-target gap ("exile two target permanents", "exile
  // up to one target permanent") alongside direct "destroy target creature".
  // Damage-based removal (burn/reach — Lightning Bolt, Massive Raid,
  // Endbringer) and sacrifice-edicts with any forcing subject (not just
  // "target player" — Vraska's Fall, Fleshbag Marauder, Grave Pact) round out
  // the common removal shapes the raw tag already covers. Threaten effects
  // ("gain control of target creature") and Pacifism/Song-of-the-Dryads-style
  // auras ("loses all abilities") are real, distinct removal templating, not
  // destroy/exile at all.
  removal:
    /(destroy|exile)[^.]*?target|counter target spell|return target (creature|permanent|artifact|enchantment|planeswalker|spell)|fights? target creature|target creature gets? [+-]?\d+\/-\d+|(target player|each opponent|defending player|each player|each other player)[^.]*?sacrifice|damage[^.]*?to (target|any target)\b|gain control of target creature|loses all( other card types and)? abilities/i,
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
  boardwipe:
    /destroy all|destroy each|exile all|exile each (creature|permanent)|all creatures (get|take|deal)|each creature (gets|takes)|creatures[^.]*?get -\d+\/-\d+|damage to each creature|return all [^.]*?(creatures|permanents)|return each (creature|permanent)|each player sacrifices (a|all)|(\+1\/\+1|-1\/-1) counters? on each creature|for each opponent[^.]*?destroy|(?=[\s\S]*\boverload\b)(?=[\s\S]*\b(?:destroy|exile|return) target\b)/i,
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
  cardDraw:
    /draws? (a|two|three|four|x|that many|cards? equal to)|search your library for [^.]*?cards?\b|search(ing|es)? (your|their|its) library|each player draws|whenever [^.]*?draws? a card|top[^.]{0,15}?of (your|their|its) library|return[^.]*?graveyard[^.]*?hand/i,
};

// Positive-evidence classifier for the protection/free-interaction class
// (iter-7 Slice A, E87-new). Unlike ROLE_EVIDENCE, there is no tagger tag to
// gate on first — refresh-tagger.mjs has no otag fetch list to add to, and
// the shipped `protection` otag is sparse (29 cards) and mixed-signal (mostly
// "mentions the protection keyword," not "protects your stuff"). Pure
// oracle-text classification, a PARALLEL flag rather than a 5th RoleKey — no
// pick-time target/cap/floor, called directly wherever a "never evict this"
// signal is needed (see computeTrimResistance, phaseCoherenceRepair,
// phaseBudgetConverge, phaseBracketConverge, the Combo Integrity Audit).
//
// Branches (each an independent OR-alternative):
//  1. Mass/anthem grant to YOUR stuff — "permanents/creatures you control
//     have/gain hexproof/shroud/indestructible" (Heroic Intervention, Avacyn
//     Angel of Hope, Sigarda Font of Blessings).
//  2. Equipment granting the keyword to its bearer (Lightning Greaves,
//     Swiftfoot Boots).
//  3. Single-target protection grant, one-shot or activated (Mother of
//     Runes, Faith's Shield, Tamiyo's Safekeeping).
//  4. Free alternative-cost counter/redirect template — "without paying its
//     mana cost ... counter target spell / choose new targets" (Fierce
//     Guardianship). `[\s\S]*?` (not `[^.]` like the other branches)
//     deliberately crosses the sentence boundary between the alt-cost clause
//     and the effect clause — real cards in this template put them in
//     separate sentences.
//  5. Unconditional spell/ability redirect (Deflecting Swat — its actual
//     alt-cost phrasing is "rather than pay," not "without paying," so this
//     branch (not #4) is what catches it).
//  6. A granting subject's spells can't be countered — "spells you control"
//     or "target spell," NOT a bare self-clause. This is the amended form:
//     a plain `can'?t be countered` would also match a boardwipe's own
//     self-protection line (Supreme Verdict, Carnage Tyrant, Loxodon
//     Smiter's "This spell can't be countered") and silently grant them
//     trim immunity they were never meant to have. Requiring a "you
//     control"/"target" subject excludes that self-clause while still
//     catching Prowling Serpopard ("Creature spells you control can't be
//     countered") and Vexing Shusher ("Target spell can't be countered").
//  7. Teferi's-Protection-style phasing / "can't lose the game" fog.
//
// False-positive guard: Progenitus's bare "Protection from everything" static
// keyword line matches none of the above — every branch requires a grant verb
// (have/gain(s)) or an explicit target/subject qualifier adjacent to the
// keyword, not a standalone "Protection from X" line.
//
// Slice-A fix (iter-10): the counter-clause literal was `counter target
// spell`, which misses `Counter target NONCREATURE spell` — Fierce
// Guardianship's and Force of Negation's exact live wording (verified
// against Scryfall) — so both silently fell through this branch. Widened to
// `counter target(?: noncreature)? spell`; only widens matches, never narrows.
//
// E137 fix: branch 7's `in` alternative was un-anchored to the phasing verb,
// so ANY sentence containing both "phase" and a bare "in" nearby matched —
// "there is an additional combat phase followed by an additional main
// phase" (Aggravated Assault, World at War, Seize the Day), "during your
// main phase, you gain 2 life" (Sphinx's Insight), "your first main phase,
// add four mana IN any combination" (Cosmic Crucible), "the first combat
// phase of the turn" (Karlach, Fury of Avernus) all wrongly tripped this and
// granted trim immunity. Requiring `out`/`in` immediately follow the
// phasing verb (`phas(?:es?|ing|ed)\s+(?:out|in)\b`) fixes all six while
// still matching Teferi's Protection ("permanents you control phase out" /
// "They phase in before you untap") and Reality Ripple ("phases out" /
// "phases in") — verified against real Scryfall oracle text. The
// long-range "along with you" alternative is unaffected/kept as-is.
const PROTECTION_EVIDENCE =
  /(permanents?|creatures?) you control[^.]*?(have|gains?)[^.]*?(hexproof|shroud|indestructible)|equipped (creature|permanent)[^.]*?(has|have)[^.]*?(hexproof|shroud|indestructible)|target (creature|permanent)[^.]*?gains? (hexproof|shroud|indestructible|protection from)|without paying (its|this spell.?s) mana cost[\s\S]*?(counter target(?: noncreature)? spell|choose new targets)|choose new targets for target spell or ability|(spells? you control|target spell)[^.]*?can'?t be countered|phas(?:es?|ing|ed)\s+(?:out|in)\b|phas(?:e|ing)[^.]*?along with you|can'?t lose the game/i;

/**
 * Positive-evidence protection/free-interaction classifier (E87-new Slice A).
 * Pure oracle-text check, independent of `RoleKey`/`getCardRole` — see
 * PROTECTION_EVIDENCE above for the branch-by-branch rationale. Unlike
 * `validateCardRole`, there is no tag to fall back to, so a text-less card
 * simply returns false (can't confirm a class we can't read evidence for —
 * the opposite fallback direction from validateCardRole, which trusts the
 * tag when text is unavailable; this classifier has no tag to trust).
 */
export function isProtectionPiece(card: {
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
  return PROTECTION_EVIDENCE.test(text);
}

// Free-interaction / reflexive alt-cost pieces (iter-10 Slice A) — cards whose
// OWN oracle text lets you cast THEM without their printed mana cost
// (reflexively, not as a favor granted to other spells) AND whose payoff is
// itself interaction. Boundary and every branch below is live-verified
// against real Scryfall oracle text — see the build spec for the full
// candidate table; summarized per branch:
//
// Branch A — reflexive "rather than pay this/its OWN mana cost": Commandeer
// ("You may exile two blue cards from your hand rather than pay this
// spell's mana cost."), Force of Will, Force of Negation, Misdirection,
// Foil, Daze, Snuff Out. Requires "this spell's"/"its" immediately after
// "rather than pay ... mana cost" — this is what excludes Dream Halls
// ("...for A SPELL"), As Foretold/Fist of Suns/Omniscience/Aluren ("...for
// spells you cast"/"spells from your hand"), which grant the discount to
// spells OTHER than themselves (enablers, not free-interaction spells).
//
// E137 fix: "free" means zero mana, but this branch didn't check what the
// alt cost actually WAS — Baleful Mastery ("pay {1}{B} rather than pay this
// spell's mana cost") and Admiral's Order ("pay {U} rather than pay this
// spell's mana cost") both still cost real mana and wrongly flagged as
// free. The negative lookbehind rejects a mana-symbol token (other than
// {0}) immediately before "rather than pay" — Ravenous Trap/Mindbreak Trap
// ("pay {0} rather than pay...") stay free, Baleful Mastery/Admiral's
// Order/Runeflare Trap ({1}{B}/{U}/{R}) are excluded, and non-mana
// alt-costs (sacrifice/life/exile-a-card — Unmask, Force of Will, ...) are
// untouched since no mana token precedes "rather than pay" there at all.
const ALT_COST_REFLEXIVE =
  /(?<!\{(?!0\})[^}]*\}\s)rather than pay (?:this spell'?s|its) mana cost/i;

// Branch B — commander-gated free cast: Deadly Rollick, Deflecting Swat,
// Fierce Guardianship, Flawless Maneuver all share this exact live wording.
const COMMANDER_FREE_CAST =
  /if you control a commander,? you may cast this spell without paying its mana cost/i;

// Branch D — Evoke cycle: Fury/Solitude/Subtlety/Endurance/Grief all print
// "Evoke—Exile a <color> card from your hand." verbatim (live-verified).
const EVOKE = /\bevoke\s*[—-]\s*exile a .{0,25} card from your hand/i;

// Branch E — Pact deferred-payment cycle: Pact of Negation / Slaughter Pact
// ("At the beginning of your next upkeep, pay {cost}. If you don't, you
// lose the game.", live-verified).
const PACT_DEFERRED =
  /at the beginning of your next upkeep,? pay [^.]*\. if you don'?t,? you lose the game/i;

const ALT_COST_EVIDENCE = new RegExp(
  [ALT_COST_REFLEXIVE, COMMANDER_FREE_CAST, EVOKE, PACT_DEFERRED].map((r) => r.source).join('|'),
  'i'
);

// Interaction gate — the payoff itself must be counter/destroy/exile/steal/
// redirect/damage-sweep/library-tuck/graveyard-hate/hand-disruption. Every
// branch cites the live text it exists for:
//  - "counter target"             → Force of Will/Negation, Fierce
//                                    Guardianship ("Counter target
//                                    noncreature spell"), Foil, Daze, Pact
//                                    of Negation
//  - "destroy target"             → Snuff Out, Slaughter Pact
//  - "exile target"                → Deadly Rollick
//  - "exile up to ... target"      → Solitude ("exile up to one other
//                                    target creature")
//  - "gain control of target"      → Commandeer
//  - "choose new targets"          → Commandeer, Deflecting Swat
//  - "change the target"           → Misdirection
//  - "deals ... damage ... target" → Fury
//  - "puts ... library"            → Subtlety ("puts it on ... top or
//                                    bottom of their library"), Endurance
//                                    ("puts all the cards from their
//                                    graveyard on the bottom of their
//                                    library")
//
// E137 fix — the contract is interaction = counterspell / threat removal /
// protection, not discard/graveyard-hate/player-burn. Three narrowings, all
// verified against real Scryfall oracle text:
//  - Dropped the "target player/opponent ... reveals/discards" branch
//    outright — its only real cards, Grief ("target opponent reveals their
//    hand ... discards that card") and Unmask (same shape), are pure
//    targeted discard, not interaction with a threat.
//  - "puts...library" narrowed from `(?:it|them|all the cards)` to
//    `(?:it|them)` — drops the "all the cards" arm, which existed only for
//    Endurance's graveyard-hate ("puts all the cards from their graveyard
//    on the bottom of their library"); Subtlety's genuine spell-tuck ("puts
//    it on the top or bottom of their library") still matches via "it".
//  - "exile target" gets a same-sentence negative lookahead against
//    "graveyard" — Ravenous Trap ("Exile target player's graveyard") no
//    longer trips the bare phrase; Deadly Rollick/Baleful Mastery ("exile
//    target creature or planeswalker") are untouched.
//  - The damage branch gets a same-position negative lookahead against
//    "target player" — Runeflare Trap ("deals damage to target player")
//    is excluded; Fury ("deals 4 damage ... among any number of target
//    creatures and/or planeswalkers") is untouched.
//  - Added "exile ... target spell(s)" as its own branch — Mindbreak Trap
//    ("Exile any number of target spells") is genuine free interaction
//    (counterspell-adjacent) but was missing evidence entirely (known FN).
const INTERACTION_EVIDENCE =
  /counter target|destroy target|exile target(?![^.]*?graveyard)|exile up to [^.]*?target|exile[^.]*?target spells?\b|gain control of target|choose new targets|change the target|deals? [^.]*?damage[^.]*?target(?!\s+player\b)|puts? (?:it|them)[^.]*?library/i;

/**
 * Positive-evidence free-interaction classifier (iter-10 Slice A). Pure
 * oracle-text check, same shape as isProtectionPiece/isUntapProducer — no
 * tag to fall back to, so a text-less card returns false.
 *
 * Scoped to the non-protection remainder by construction: some in-scope
 * candidates (Deflecting Swat, Flawless Maneuver) already trip
 * isProtectionPiece, so this guards `isProtectionPiece(card) → false` up
 * front rather than requiring every one of the ~6 consumer call sites to
 * OR/max the two classifiers themselves — a single `return false` here
 * applies uniformly everywhere and can't drift out of sync at a call site.
 * (With the PROTECTION_EVIDENCE noncreature-branch fix above, Fierce
 * Guardianship trips isProtectionPiece and IS excluded here; Force of
 * Negation is NOT — its counter clause follows "rather than pay", not
 * "without paying", so it never reaches the protection counter branch and
 * stays free-interaction.)
 */
export function isFreeInteraction(card: {
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
  if (isProtectionPiece(card)) return false; // never double-boost — see overlap ruling above
  return ALT_COST_EVIDENCE.test(text) && INTERACTION_EVIDENCE.test(text);
}

// Untap producers (E89, iter-7 Slice E) — cards whose own oracle text untaps
// OTHER permanents, or repeats your untap step. Same shape as
// isProtectionPiece: a pure oracle-text predicate, no tagger tag to fall
// back to (a text-less card returns false). Deliberately producer-only — see
// packageBoost.ts's computeUntapVisibilityBoosts doc for why a payoff side
// isn't viable (the only structurally-true "untap payoff," a bare {T}-only
// activated ability, matches nearly every mana rock/dork in the format).
//
// Three verified shapes (against real Scryfall oracle text):
//  1. "untap [up to N/another] target X" — Aphetto Alchemist ("Untap target
//     artifact or creature."), Vizier of Tumbling Sands ("Untap another
//     target permanent."), Fatestitcher ("tap or untap another target
//     permanent"), Kelpie Guide, Kiora's Follower, and Tezzeret, Cruel
//     Captain's loyalty ability ("0: Untap target artifact or creature...")
//     — loyalty text is plain oracle_text for a single-faced card, no
//     special-casing needed.
//  2. "untap all [nonland] X you control" — Dramatic Reversal ("Untap all
//     nonland permanents you control."), Drumbellower, Seedborn Muse,
//     Unwinding Clock (each "Untap all <permanents|creatures|artifacts> you
//     control during each other player's untap step" — matched on the
//     "untap all ... you control" prefix, the untap-step clause isn't
//     required).
//  3. A bare "untap them" callback — Valley Floodcaller ("... get +1/+1
//     until end of turn. Untap them.").
//
// False-positive guards, all verified against real cards: the tap-down
// idiom ("doesn't untap during its controller's ... untap step" — Frost
// Titan, Icefall Regent) puts "untap" before "during", never before
// "target"/"all"/"them", so it can't satisfy any branch by construction. The
// self-only "you may choose not to untap this ~ during your untap step"
// idiom (Amber Prison) is the same shape. Winter Orb's "players can't untap
// more than one land" fails likewise (no "target"/"all ... you control"
// object). An exert creature's own boilerplate ("An exerted creature won't
// untap during your next untap step" — Ahn-Crop Crasher) is the tap-down
// idiom again. (Known accepted miss, not in scope for v1: a rarer exert
// payoff that untaps OTHER creatures, e.g. Ahn-Crop Champion's "untap all
// OTHER creatures you control" — the extra "other" breaks branch 2's fixed
// word sequence. Low-stakes since this is a visibility boost, not a gate.)
const UNTAP_PRODUCER =
  /\buntap (?:up to (?:one|two|three|four|x|\d+) |another )?target (?:artifact|creature|land|permanent)|\buntap all (?:nonland )?(?:permanents|creatures|artifacts|lands) you control|\buntap them\b/i;

// E137 fix (measured 55% precision) — two exclusion classes, both verified
// against real Scryfall oracle text:
//  (a) Threaten-style untap+steal — Spinal Embrace ("Untap target creature
//      you don't control and gain control of it") and Overtaker ("Untap
//      target creature and gain control of it until end of turn") untap an
//      OPPONENT's creature as incidental setup for stealing it; the untap
//      isn't an engine, it's a Threaten effect. A same-sentence "gain
//      control of" co-occurrence catches both regardless of activated-
//      ability shape (Overtaker has a real `{cost}, {T}:` activation, so a
//      repeatability heuristic alone wouldn't exclude it).
const UNTAP_STEAL_EXCLUSION = /\buntap[^.]*?\bgain control of\b/i;

//  (b) One-shot riders bolted onto an unrelated card — Pestermite ("When
//      this creature enters, you may tap or untap target permanent"),
//      Granite Witness ("When this creature is turned face up, you may tap
//      or untap target creature"), Rally to Battle ("Creatures you control
//      get +1/+3 until end of turn. Untap them."), and Molten Note ("...
//      Untap all creatures you control.") are textually identical in shape
//      to genuine untap engines (Kiora's Follower, Dramatic Reversal) — the
//      difference is "is untapping this card's whole purpose or an ETB/
//      combat-trick afterthought," which isn't reliably regex-detectable
//      (Dramatic Reversal's ENTIRE text is a bare "Untap all nonland
//      permanents you control." with no repeatable-ability marker either,
//      so a marker-presence heuristic would wrongly exclude it too). A
//      curated exclusion — same shape as EXTRA_COMBAT_CURATED_NAMES above —
//      is the honest minimal fix for this specific FP class.
const UNTAP_ONE_SHOT_RIDER_NAMES: ReadonlySet<string> = new Set([
  'Pestermite',
  'Granite Witness',
  'Rally to Battle',
  'Molten Note',
]);

/**
 * Positive-evidence untap-producer classifier (E89, iter-7 Slice E). Pure
 * oracle-text check, independent of `RoleKey`/`getCardRole` — see
 * UNTAP_PRODUCER above. No tag to fall back to, so a text-less card simply
 * returns false (mirrors isProtectionPiece's fallback direction, not
 * validateCardRole's).
 */
export function isUntapProducer(card: {
  name: string;
  oracle_text?: string;
  card_faces?: Array<{ oracle_text?: string }>;
}): boolean {
  if (UNTAP_ONE_SHOT_RIDER_NAMES.has(card.name)) return false;
  const text = (
    card.oracle_text ??
    card.card_faces?.map((f) => f.oracle_text ?? '').join(' ') ??
    ''
  ).trim();
  if (!text) return false;
  if (!UNTAP_PRODUCER.test(text)) return false;
  return !UNTAP_STEAL_EXCLUSION.test(text);
}

// Blink/flicker producers (iter-8 Slice B) — same shape as isUntapProducer: a
// pure oracle-text predicate, producer-only (see packageBoost.ts's
// computeBlinkVisibilityBoosts doc for why an ETB-payoff side isn't viable —
// it's satisfied by roughly half of all EDH creatures, same precision-~0
// failure class as untap's rejected payoff signal).
//
// The discriminator that actually matters is the PRONOUN, not a "you
// control/own" clause: true blink always returns the just-exiled thing via
// an anaphoric pronoun ("it"/"that card"/"those cards"/"them"), never a
// fresh noun phrase. This is what separates a true blink effect (Flickerwisp:
// "exile another target permanent. Return that card to the battlefield
// under its owner's control") from an O-Ring-style soft-removal card (Fiend
// Hunter: "return THE EXILED CARD to the battlefield" — a noun phrase, and
// conditioned on itself dying) or a graveyard-reanimation card (Nethroi,
// Apex of Death: "return any number of target creature cards ... from your
// graveyard to the battlefield" — no exile at all in the return step). Cast
// Out and Banisher Priest don't even reach the pronoun check: neither
// contains "return" at all (they use "until this leaves the battlefield"
// duration wording).
//
// Verified against real Scryfall oracle text: Ephemerate, Momentary Blink,
// Conjurer's Closet, Thassa Deep-Dwelling, Teleportation Circle, Charming
// Prince, Restoration Angel, Felidar Guardian, Ghostly Flicker, Displacer
// Kitten, Brago King Eternal, Aminatou the Fateshifter, Flickerwisp, Eerie
// Interlude, Cloudshift all match; Fiend Hunter, Cast Out, Banisher Priest,
// Nethroi Apex of Death, Yarok the Desecrated (no "exile" at all) all reject.
const BLINK_PRODUCER =
  /\bexile\b[\s\S]{0,80}?\breturn (?:it|that card|those cards|them) to the battlefield\b/i;

// E137 fix (measured 55% precision) — two exclusion classes, both verified
// against real Scryfall oracle text:
//  (a) Saga/Class self-transform reminder text — every transforming Saga's
//      chapter III reads "Exile this Saga, then return it to the
//      battlefield transformed under your control" verbatim (The Modern
//      Age, Era of Enlightenment, Azusa's Many Journeys, Boseiju Reaches
//      Skyward, Befriending the Moths all confirmed identical wording) —
//      this trips BLINK_PRODUCER's exile/return-to-battlefield shape but is
//      a one-time self-transform, not a return-for-ETB-value blink. Real
//      blink return clauses never say "transformed" there, so that single
//      word is a clean, generalizable exclusion.
const SAGA_TRANSFORM_EXCLUSION =
  /\breturn (?:it|that card|those cards|them) to the battlefield transformed\b/i;

//  (b) One-shot self-saves and opponent-permanent tempo/O-Ring removal —
//      Anurid Brushhopper ("Exile this creature. Return it to the
//      battlefield under its owner's control...") and Cosmic Intervention
//      (same shape, as a death-replacement effect) only ever target their
//      OWN permanent to dodge removal — a one-shot save, not a return-for-
//      value blink engine. Vizier of Deferment ("you may exile target
//      creature if it attacked or blocked this turn...") is combat-
//      conditioned tempo removal of a creature that just attacked/blocked,
//      the same O-Ring/tempo idiom as Koya, Death from Above (which is
//      already excluded by BLINK_PRODUCER's own {0,80}-char return-clause
//      gap — verified, no change needed there). None of these three are
//      textually distinguishable from genuine blink (Essence Flux, Flicker
//      of Fate, ...) by the pronoun/return-clause shape alone — same
//      curated shape as EXTRA_COMBAT_CURATED_NAMES / UNTAP_ONE_SHOT_RIDER_NAMES
//      above.
const BLINK_CURATED_EXCLUSION_NAMES: ReadonlySet<string> = new Set([
  'Anurid Brushhopper',
  'Cosmic Intervention',
  'Vizier of Deferment',
]);

export function isBlinkProducer(card: {
  name: string;
  oracle_text?: string;
  card_faces?: Array<{ oracle_text?: string }>;
}): boolean {
  if (BLINK_CURATED_EXCLUSION_NAMES.has(card.name)) return false;
  const text = (
    card.oracle_text ??
    card.card_faces?.map((f) => f.oracle_text ?? '').join(' ') ??
    ''
  ).trim();
  if (!text) return false;
  if (!BLINK_PRODUCER.test(text)) return false;
  return !SAGA_TRANSFORM_EXCLUSION.test(text);
}

// Exile-matters (impulse draw) producers (iter-8 Slice B) — same shape again:
// a pure oracle-text predicate, producer-only. Bounded to the "exile the top
// [N] card(s) of your library ... you may play/cast" impulse shape (Prosper's
// Mystic Arcanum, Light Up the Stage, Jeska's Will, Valakut Exploration,
// Laelia the Blade Reforged all verified matching). Discard-based impulse
// (Anje's Ravager + Madness) and foretell/suspend/adventure (Alrund's
// Epiphany) are out of scope for v1 — no "top ... library" phrase, same
// "accepted miss, low stakes for an additive boost" framing as untap's
// Ahn-Crop Champion note.
//
// Urianger Augurelt's own Draw/Play Arcanum text is a verified non-match by
// construction: his "exile" clause ("You may exile it face down") is never
// immediately followed by "the top ... cards of your library" (that phrase
// belongs to the PRIOR clause, describing what was looked at) — see
// hasExilePayoffIdentity in deckGenerator.ts for how he's still caught via
// the commander gate instead.
const EXILE_PRODUCER =
  /\bexile the top (?:\w+ )?cards? of your library\b[\s\S]{0,60}?\byou may (?:play|cast)\b/i;

export function isExileProducer(card: {
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
  return EXILE_PRODUCER.test(text);
}

// Extra-combat producers (E102, iter-11 Slice C) — same shape again: a pure
// oracle-text predicate, producer-only. Bounded to the "additional combat
// phase" idiom every real extra-combat card shares verbatim — verified
// against real Scryfall oracle text for: Aggravated Assault ("After this
// main phase, there is an additional combat phase followed by an additional
// main phase."), Combat Celebrant ("after this phase, there is an additional
// combat phase"), Moraug, Fury of Akoum ("there's an additional combat phase
// after this phase"), Port Razer, Scourge of the Throne, World at War,
// Aurelia, the Warleader, Karlach, Fury of Avernus, Response // Resurgence
// (Resurgence half), Seize the Day, Waves of Aggression, and Breath of Fury —
// all twelve match. Verified NON-matches: Vitalize ("Untap all creatures you
// control.", no combat-phase clause at all) and Windcrag Siege (the Mardu
// mode is the "attacking causes ... triggers an additional time" DOUBLER
// idiom — commanderProfile.ts's attack-trigger detector, not this one — its
// text never says "combat phase").
const EXTRA_COMBAT_PRODUCER = /\badditional combat phases?\b/i;

// Curated inclusion: Helm of the Host is EDHREC's #1 "Extra Combats" card
// (844/29k Isshin decks) but its own oracle text never says "additional
// combat phase" — it duplicates the attacker instead of adding a combat step
// ("At the beginning of combat on your turn, create a token that's a copy of
// equipped creature, except the token isn't legendary. That token gains
// haste." — verified against Scryfall). No other real card shares this
// "beginning of combat" + "copy of equipped creature" shape, so a generic
// regex branch here would just be a one-card rule wearing a regex costume;
// a name-set is the honest, minimal version of the same rule. Same idiom as
// STAPLE_ROCK_NAMES (phaseStapleManaRocks.ts) — a curated allowlist beside a
// regex, not a replacement for one.
const EXTRA_COMBAT_CURATED_NAMES: ReadonlySet<string> = new Set(['Helm of the Host']);

export function isExtraCombatPiece(card: {
  name: string;
  oracle_text?: string;
  card_faces?: Array<{ oracle_text?: string }>;
}): boolean {
  if (EXTRA_COMBAT_CURATED_NAMES.has(card.name)) return true;
  const text = (
    card.oracle_text ??
    card.card_faces?.map((f) => f.oracle_text ?? '').join(' ') ??
    ''
  ).trim();
  if (!text) return false;
  return EXTRA_COMBAT_PRODUCER.test(text);
}

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
const ONE_SIDED_WIPE_EVIDENCE =
  /\b(?:destroy|exile)\b[^.]*?\ball\b[^.]*?you don'?t control|\b(?:destroy|exile)\b[^.]*?\ball\b[^.]*?your opponents? control|(?=[\s\S]*\boverload\b)(?=[\s\S]*\b(?:destroy|exile|return) target [^.]*?you don'?t control\b)/i;

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
  return {
    creatures: WIPE_SCOPE_CREATURES.test(text),
    artifacts: WIPE_SCOPE_ARTIFACTS.test(text),
    enchantments: WIPE_SCOPE_ENCHANTMENTS.test(text),
    planeswalkers: WIPE_SCOPE_PLANESWALKERS.test(text),
    all: WIPE_SCOPE_ALL.test(text),
  };
}

/**
 * Positive-evidence-gated role classification. Returns the same role
 * `getCardRole` would (by name) IFF the card's own oracle text corroborates
 * it — otherwise drops the role. Guards against upstream tagger mistags and
 * corrupt/mismatched Scryfall records (a cached card whose oracle_text
 * doesn't match its type, inflating a role count with an effect it doesn't
 * have). Falls back to trusting the tag when no oracle text is available to
 * check against (can't validate what we can't read), so a face with no text
 * doesn't lose a real role for lack of data.
 *
 * NOTE: shared with live generation (categorize.ts, scryfallFill.ts,
 * cardPicking.ts, deckGenerator.ts) — this is not report-only, so evidence
 * text stays "join every face" here. A DFC-aware tightening (e.g. front-face
 * primacy for a transforming card's back-face-only payoff) belongs in a
 * report-only wrapper instead; see `reportRoleOf` in commanderDeckAnalysis.ts.
 */
export function validateCardRole(card: {
  name: string;
  oracle_text?: string;
  card_faces?: Array<{ oracle_text?: string }>;
}): RoleKey | null {
  const role = getCardRole(card.name);
  if (!role) return null;
  const text = (
    card.oracle_text ??
    card.card_faces?.map((f) => f.oracle_text ?? '').join(' ') ??
    ''
  ).trim();
  if (!text) return role;
  return ROLE_EVIDENCE[role].test(text) ? role : null;
}

/** Get the subtype of a card for its primary role (if any). */
export function getCardSubtype(cardName: string): string | null {
  const role = getCardRole(cardName);
  if (!role) return null;
  switch (role) {
    case 'ramp':
      return getRampSubtype(cardName);
    case 'removal':
      return getRemovalSubtype(cardName);
    case 'boardwipe':
      return getBoardwipeSubtype(cardName);
    case 'cardDraw':
      return getCardDrawSubtype(cardName);
    default:
      return null;
  }
}
