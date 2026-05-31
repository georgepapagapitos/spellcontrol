import type { GapAnalysisCard } from '@/deck-builder/types';
import {
  cardMatchesRole,
  getCardSubtype,
  type RoleKey,
} from '@/deck-builder/services/tagger/client';

/**
 * Owned-substitute finder — for a recommended-but-missing staple, find a card
 * the user already owns that fills the same functional role, within the deck's
 * color identity and not already in the list. Turns a "shopping list" of cards
 * to buy into a "Wanted X → Used Y you own" substitution.
 *
 * Pure and synchronous. Like `costAnalyzer` / `gapAnalysisBuilder`, the output
 * (`SubstituteRow`) is **lean and persistable** — card names + primitives only,
 * never embedded card objects. The owned pool is a lean `SubstituteCandidate[]`
 * (name + color identity + CMC), which the live collection (`EnrichedCard`) and
 * the Scryfall card shape both map onto trivially — keeping this module decoupled
 * from any one card representation.
 *
 * The `reason` string is the verdict copy the substitution UI surfaces (and the
 * planned verdict-badge work reuses): e.g. "Mind Stone fills the 2-mana ramp
 * slot — owned, same mana rock."
 */

/** Minimal owned-card shape the finder needs — maps from `EnrichedCard` or `ScryfallCard`. */
export interface SubstituteCandidate {
  name: string;
  /** WUBRG color-identity keys (`EnrichedCard.colorIdentity` / `ScryfallCard.color_identity`). */
  colorIdentity: string[];
  /** Mana value, for slot-closeness ranking. */
  cmc?: number;
}

/** A candidate fits when its whole color identity sits inside the deck's (mirrors `fitsColorIdentity`). */
function fitsIdentity(candidate: SubstituteCandidate, identity: string[]): boolean {
  return candidate.colorIdentity.every((c) => identity.includes(c));
}

export interface SubstituteRow {
  /** The missing staple we wanted (EDHREC-recommended, not owned). */
  wantedName: string;
  /** Functional role both cards fill. */
  wantedRole: RoleKey;
  /** Display label for the role (e.g. "Ramp"), if known. */
  wantedRoleLabel?: string;
  /** Mana value of the wanted card's slot, if known. */
  wantedCmc?: number;
  /** The owned card we'll use instead. */
  usedName: string;
  /** True when the owned card shares the wanted card's subtype (mana-rock→mana-rock). */
  usedSubtypeMatch: boolean;
  /** Plain-English rationale (the verdict copy). */
  reason: string;
}

export interface SubstitutionPlan {
  /** One row per missing staple we could fill from the collection. */
  rows: SubstituteRow[];
  /** Missing staples with no owned substitute — genuine "buy" decisions. */
  unmatched: string[];
}

export interface SubstituteFinderOptions {
  /** EDHREC inclusion % by card name — ranks closer (more-played) substitutes first. */
  inclusionByName?: Map<string, number>;
}

/** Functional roles the tagger recognizes (mirrors `RoleKey`). */
const ROLE_KEYS = new Set<RoleKey>(['ramp', 'removal', 'boardwipe', 'cardDraw']);

/** Display labels for functional roles (mirrors `gapAnalysisBuilder`'s ROLE_LABELS). */
const ROLE_LABELS: Record<RoleKey, string> = {
  ramp: 'ramp',
  removal: 'removal',
  boardwipe: 'board wipe',
  cardDraw: 'card advantage',
};

/** Narrow `GapAnalysisCard.role` (a free `string`) to a known `RoleKey`, or null. */
function asRoleKey(role: string | undefined): RoleKey | null {
  return role && ROLE_KEYS.has(role as RoleKey) ? (role as RoleKey) : null;
}

/** Humanize a subtype tag for the reason string ("mana-rock" → "mana rock"). */
function humanizeSubtype(subtype: string): string {
  return subtype.replace(/-/g, ' ');
}

interface RankedCandidate {
  card: SubstituteCandidate;
  subtypeMatch: boolean;
  cmcDelta: number;
  inclusion: number;
}

/**
 * Find the single best owned card to substitute for one missing staple, or null
 * when nothing in the collection fits (→ a genuine "buy"). Candidates must be
 * owned, in color identity, role-matched, and not already in the deck.
 *
 * Ranking (best first): same-subtype, then closest CMC to the wanted slot, then
 * highest EDHREC inclusion, then name (for determinism).
 */
export function findOwnedSubstitute(
  missing: GapAnalysisCard,
  ownedPool: readonly SubstituteCandidate[],
  deckNames: ReadonlySet<string>,
  identity: string[],
  opts: SubstituteFinderOptions = {}
): SubstituteRow | null {
  const role = asRoleKey(missing.role);
  if (!role) return null; // no role → nothing to match against

  const wantedSubtype = getCardSubtype(missing.name);
  const inclusionByName = opts.inclusionByName;

  const ranked: RankedCandidate[] = [];
  for (const card of ownedPool) {
    if (card.name === missing.name) continue; // never substitute a card for itself
    if (deckNames.has(card.name)) continue; // already in the deck
    if (!fitsIdentity(card, identity)) continue; // outside the deck's identity
    if (!cardMatchesRole(card.name, role)) continue; // wrong role

    const subtypeMatch = wantedSubtype != null && getCardSubtype(card.name) === wantedSubtype;
    const cmcDelta =
      missing.cmc != null && card.cmc != null ? Math.abs(card.cmc - missing.cmc) : Infinity;
    ranked.push({
      card,
      subtypeMatch,
      cmcDelta,
      inclusion: inclusionByName?.get(card.name) ?? 0,
    });
  }

  if (ranked.length === 0) return null;

  ranked.sort((a, b) => {
    if (a.subtypeMatch !== b.subtypeMatch) return a.subtypeMatch ? -1 : 1;
    if (a.cmcDelta !== b.cmcDelta) return a.cmcDelta - b.cmcDelta;
    if (a.inclusion !== b.inclusion) return b.inclusion - a.inclusion;
    return a.card.name.localeCompare(b.card.name);
  });

  const best = ranked[0];
  const roleLabel = missing.roleLabel ?? ROLE_LABELS[role];
  const usedSubtype = getCardSubtype(best.card.name);

  return {
    wantedName: missing.name,
    wantedRole: role,
    wantedRoleLabel: roleLabel,
    wantedCmc: missing.cmc,
    usedName: best.card.name,
    usedSubtypeMatch: best.subtypeMatch,
    reason: buildReason(best.card.name, roleLabel, missing.cmc, best.subtypeMatch, usedSubtype),
  };
}

/** Compose the verdict sentence. */
function buildReason(
  usedName: string,
  roleLabel: string,
  wantedCmc: number | undefined,
  subtypeMatch: boolean,
  usedSubtype: string | null
): string {
  const slot = wantedCmc != null ? `${wantedCmc}-mana ${roleLabel}` : roleLabel;
  const tail = subtypeMatch && usedSubtype ? `same ${humanizeSubtype(usedSubtype)}` : 'same role';
  return `${usedName} fills the ${slot} slot — owned, ${tail}.`;
}

/**
 * Build the full substitution plan for a set of missing staples: greedily assign
 * each staple the best owned substitute, with each owned card offered to at most
 * one staple (so two missing ramp pieces don't both claim the same Mind Stone).
 * Staples processed in input order — pass them ranked (e.g. by inclusion) so the
 * most-wanted staples get first pick of the collection.
 *
 * Pure. Staples with no owned fit land in `unmatched` (genuine buys).
 */
export function buildSubstitutionPlan(
  missingStaples: readonly GapAnalysisCard[],
  ownedPool: readonly SubstituteCandidate[],
  deckNames: ReadonlySet<string>,
  identity: string[],
  opts: SubstituteFinderOptions = {}
): SubstitutionPlan {
  const rows: SubstituteRow[] = [];
  const unmatched: string[] = [];
  const claimed = new Set<string>();

  for (const missing of missingStaples) {
    // Hide already-claimed owned cards from this staple's search.
    const pool = claimed.size === 0 ? ownedPool : ownedPool.filter((c) => !claimed.has(c.name));
    const row = findOwnedSubstitute(missing, pool, deckNames, identity, opts);
    if (row) {
      rows.push(row);
      claimed.add(row.usedName);
    } else {
      unmatched.push(missing.name);
    }
  }

  return { rows, unmatched };
}
