/**
 * Support roles (roadmap 2.1): the jobs players ask about that the four
 * `RoleKey`s (ramp, removal, boardwipe, cardDraw) do not name. Protection,
 * recursion, graveyard hate, tutors, win conditions and mana sinks.
 *
 * ANALYSIS-ONLY. This is deliberately not a widening of `RoleKey`: that type
 * keys the generator's targets, caps and eviction, and 2.1 must not change what
 * the generator picks. The generator never imports this module.
 *
 * Same two-gate shape as `validateCardRole`:
 *  1. the card-facts multi-role record must name the role at a counted tier
 *     (primary or secondary; incidental riders never count), and
 *  2. the card's own oracle text must corroborate it (positive evidence only).
 * Both must hold: precision over recall. A card with no oracle text, or with no
 * card-facts record, fills nothing here (unlike `validateCardRole`, there is no
 * tag to fall back to). Mana sinks are the exception to gate 1: card facts have
 * no such role, so that one is oracle-text evidence alone.
 *
 * Counts are not exclusive: a card fills every support role it earns, and they
 * sit apart from the one-role-per-card counts of `computeRoleCounts`.
 */
import { getRoleFacts, type FactRole } from '@/deck-builder/services/cardFacts';
import { readsAsProtection } from '@/deck-builder/services/tagger/client';

export const SUPPORT_ROLES = [
  'protection',
  'recursion',
  'graveyardHate',
  'tutor',
  'winCon',
  'manaSink',
] as const;
export type SupportRole = (typeof SUPPORT_ROLES)[number];

export const SUPPORT_ROLE_LABELS: Record<SupportRole, string> = {
  protection: 'Protection',
  recursion: 'Recursion',
  graveyardHate: 'Graveyard hate',
  tutor: 'Tutors',
  winCon: 'Win conditions',
  manaSink: 'Mana sinks',
};

interface RoleSource {
  name: string;
  oracle_id?: string;
  oracle_text?: string;
  type_line?: string;
  card_faces?: Array<{ oracle_text?: string; type_line?: string }>;
}

/** The fact role each support role reads from; mana sinks have none. */
const FACT_ROLE: Record<Exclude<SupportRole, 'manaSink'>, FactRole> = {
  protection: 'protection',
  recursion: 'recursion',
  graveyardHate: 'graveyardHate',
  tutor: 'tutor',
  winCon: 'finisher',
};

/** Lowercased oracle text, every face, reminder text stripped, own name as `~`. */
function evidenceText(card: RoleSource): string {
  const raw = card.oracle_text ?? card.card_faces?.map((f) => f.oracle_text ?? '').join('\n') ?? '';
  let text = raw.toLowerCase().replace(/\([^)]*\)/g, '');
  for (const part of card.name.toLowerCase().split(' // ')) {
    text = text.split(part).join('~');
  }
  return text;
}

const frontTypeLine = (card: RoleSource): string =>
  (card.type_line ?? card.card_faces?.[0]?.type_line ?? '').split(' // ')[0].toLowerCase();

// ── Tutor ───────────────────────────────────────────────────────────────────
// "search your library for <object>" where the object is not a land. Lands are
// ramp or fixing (fetches, Rampant Growth), not a tutor. Mixed objects that
// name a land anywhere are skipped: precision over recall.
const TUTOR_RE = /search your library for ([^.;]*)/g;
const LANDISH = /\b(?:lands?|forests?|islands?|swamps?|mountains?|plains|wastes)\b/;

function tutorEvidence(text: string): boolean {
  for (const m of text.matchAll(TUTOR_RE)) {
    const object = m[1];
    if (LANDISH.test(object)) continue;
    if (/\bcards?\b/.test(object)) return true;
  }
  return false;
}

// ── Recursion ───────────────────────────────────────────────────────────────
// A non-land, non-self card returns from a graveyard to hand or battlefield.
// "return this card from your graveyard" (self-recursion) is not a role the
// deck fills for other cards, so `this card` / `~` objects are excluded.
const RECURSION_RE =
  /\b(?:return|put)s? ([^.;]*?)\bfrom (?:your|a|target player's|an opponent's) graveyard (?:to|onto|into) (?:your hand|the battlefield)/g;

function recursionEvidence(text: string): boolean {
  for (const m of text.matchAll(RECURSION_RE)) {
    const object = m[1];
    if (!/\bcards?\b/.test(object)) continue;
    if (/\b(?:this|~)\b/.test(object)) continue;
    if (LANDISH.test(object) && !/\b(?:creature|artifact|enchantment|permanent)\b/.test(object))
      continue;
    return true;
  }
  return false;
}

// ── Graveyard hate ──────────────────────────────────────────────────────────
// Exiling someone else's (or every) graveyard, or a replacement effect that
// exiles cards headed for any graveyard. Your OWN graveyard (delve, escape
// costs, Shadow of the Grave) is never hate.
const GRAVEYARD_HATE_RE = [
  /\bexiles? (?:all|each|target|up to \w+ target)[^.;]*?\bfrom (?:a |all |each |target (?:player|opponent)'s |each (?:player|opponent)'s |that player's |their |defending player's |opponents?' )?graveyards?/,
  /\bexiles? (?:target (?:player|opponent)|that player|each (?:player|opponent)|all (?:players|opponents))'s graveyards?/,
  /\bexiles? all graveyards\b/,
  /\bexiles? (?:target |all )?(?:cards? )?(?:in|from) (?:all |target (?:player|opponent)'s )graveyards?/,
  /\bif a (?:card|creature card|nontoken creature) would be put into (?:a|an opponent's) graveyard[^.]*?instead/,
  /\bif (?:a card|a creature|a permanent|a nontoken permanent|an? [a-z ]+) (?:an opponent owns )?would be put into (?:a|an opponent's) graveyard from (?:anywhere|the battlefield)[^.]*?exile it instead/,
  /\bcards? in (?:graveyards|(?:target |each )?(?:player|opponent)'s graveyard)[^.]*?(?:lose all abilities|can'?t be (?:cast|activated|returned))/,
  /\bplayers can'?t cast spells from graveyards\b/,
];

function graveyardHateEvidence(text: string): boolean {
  return GRAVEYARD_HATE_RE.some((re) => re.test(text));
}

// ── Win condition ───────────────────────────────────────────────────────────
// Card facts name the finisher's kind in `sub`; the text must show that kind.
const FINISHER_EVIDENCE: Record<string, RegExp> = {
  'alt-win': /\byou win the game\b/,
  drain:
    /\b(?:each|target) opponents? loses? [^.;]*?life|\bdeals? [^.;]*?damage[^.;]*?to each opponent|\bloses? life equal to/,
  // A mass pump that also gives evasion (Overrun, Craterhoof). A bare "+2/+0"
  // (Burn Bright) or a pump with no evasion (Return of the Wildspeaker) is not
  // a finisher.
  overrun:
    /\bcreatures you control (?:get|gain)[^.;]*?(?:\+\d+\/\+\d+|\+x\/\+x)[^.;]*?\b(?:trample|double strike|infect)\b|\bcreatures you control (?:get|gain) (?:trample|double strike)[^.;]*?(?:\+\d+\/\+\d+|\+x\/\+x)/,
  'extra-combat': /\badditional combat phases?\b/,
  'extra-turn': /\b(?:an )?extra turns?\b/,
  'mass-steal': /\bgain control of (?:all|each)\b/,
};
/** An extra turn that ends with "you lose the game" (Final Fortune) is a cost, not a win. */
const SELF_DESTRUCT = /\byou lose the game\b/;

// ── Mana sink ───────────────────────────────────────────────────────────────
// A non-land permanent with a repeatable activated ability whose cost is mana
// alone ("{2}{R}: ...") and whose effect is value that scales with spare mana:
// tokens, cards, damage, counters, or a pump. Abilities that are one-shot or
// utility (monstrosity, adapt, level up, regenerate, keyword grants, animating
// the permanent, mana abilities) are not sinks; precision over recall.
const MANA_ONLY_COST = /^((?:\{[0-9wubrgcxp/]+\})+):\s*(.*)$/;
const SINK_EFFECT =
  /\bcreates? [^.;]*?\btokens?\b|\bdraws? (?:a|two|three|x) cards?\b|\bdeals? (?:\d+|x) damage\b|\+1\/\+1 counters?\b|\bgets? [+-]\d+\/[+-]\d+|\bgets? \+x\/\+x|\bloses? \d+ life\b/;
const NOT_A_SINK_EFFECT =
  /\badd\b|^(?:level|monstrosity|adapt|regenerate)\b|\bonce each turn\b|\bbecomes? (?:a|an) /;

function manaSinkEvidence(text: string): boolean {
  return text.split('\n').some((line) => {
    const m = MANA_ONLY_COST.exec(line.trim());
    return m !== null && SINK_EFFECT.test(m[2]) && !NOT_A_SINK_EFFECT.test(m[2]);
  });
}

/** Does the card's oracle text corroborate `role`? Pure; no card-facts needed. */
export function supportRoleEvidence(
  role: SupportRole,
  card: RoleSource,
  finisherSubs: readonly (string | null)[] = []
): boolean {
  const text = evidenceText(card).trim();
  if (!text) return false;
  switch (role) {
    case 'protection':
      return readsAsProtection(card);
    case 'tutor':
      return tutorEvidence(text);
    case 'recursion':
      return recursionEvidence(text);
    case 'graveyardHate':
      return graveyardHateEvidence(text);
    case 'winCon':
      return finisherSubs.some(
        (s) =>
          s !== null &&
          FINISHER_EVIDENCE[s]?.test(text) &&
          !(s === 'extra-turn' && SELF_DESTRUCT.test(text))
      );
    case 'manaSink':
      return !frontTypeLine(card).includes('land') && manaSinkEvidence(text);
  }
}

/**
 * Every support role the card earns: a counted card-facts role AND oracle
 * evidence (mana sinks: evidence alone). Empty when card facts are not loaded.
 */
export function supportRolesOf(card: RoleSource): SupportRole[] {
  const facts = getRoleFacts(card, { counted: true });
  const out: SupportRole[] = [];
  for (const role of SUPPORT_ROLES) {
    if (role === 'manaSink') {
      if (supportRoleEvidence(role, card)) out.push(role);
      continue;
    }
    const mine = facts.filter((f) => f.role === FACT_ROLE[role]);
    if (mine.length === 0) continue;
    if (
      supportRoleEvidence(
        role,
        card,
        mine.map((f) => f.sub)
      )
    )
      out.push(role);
  }
  return out;
}

export interface SupportRoleSummary {
  role: SupportRole;
  label: string;
  /** Card names, one per distinct card (copies of a name count once). */
  names: string[];
}

/**
 * Support-role membership over a deck's cards. Only roles with at least one
 * card are returned: a role the deck lacks is not a finding here, it is the
 * archetype checks' (2.2) to judge against a deck's plan.
 */
export function summarizeSupportRoles(cards: readonly RoleSource[]): SupportRoleSummary[] {
  const byRole = new Map<SupportRole, Set<string>>();
  for (const card of cards) {
    for (const role of supportRolesOf(card)) {
      const set = byRole.get(role) ?? new Set<string>();
      set.add(card.name);
      byRole.set(role, set);
    }
  }
  return SUPPORT_ROLES.filter((r) => byRole.has(r)).map((role) => ({
    role,
    label: SUPPORT_ROLE_LABELS[role],
    names: [...(byRole.get(role) as Set<string>)].sort(),
  }));
}
