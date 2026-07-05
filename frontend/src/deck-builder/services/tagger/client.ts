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
const PROTECTION_EVIDENCE =
  /(permanents?|creatures?) you control[^.]*?(have|gains?)[^.]*?(hexproof|shroud|indestructible)|equipped (creature|permanent)[^.]*?(has|have)[^.]*?(hexproof|shroud|indestructible)|target (creature|permanent)[^.]*?gains? (hexproof|shroud|indestructible|protection from)|without paying (its|this spell.?s) mana cost[\s\S]*?(counter target spell|choose new targets)|choose new targets for target spell or ability|(spells? you control|target spell)[^.]*?can'?t be countered|phas(?:e|ing)[^.]*?(?:along with you|out|in)|can'?t lose the game/i;

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
