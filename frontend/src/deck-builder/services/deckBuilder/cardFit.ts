import type { ScryfallCard, GapAnalysisCard } from '@/deck-builder/types';
import { getCardRole, type RoleKey } from '@/deck-builder/services/tagger/client';
import { getFrontFaceTypeLine, isMdfcLand } from '@/deck-builder/services/scryfall/client';
import { isBasicLandName } from '@/lib/allocations';

// ── Thresholds ──────────────────────────────────────────────────────────────
const INCLUSION_LOW = 5; // %
const SYNERGY_LOW = 0; // EDHREC synergy ≤ 0
const MISFIT_REASON_THRESHOLD = 2; // need ≥ 2 reasons to flag as a misfit

// Misfit score weights
const MISFIT_REASON_WEIGHT = 10; // per reason flagged
const MISFIT_SYNERGY_WEIGHT = 5; // multiplier on negative synergy
// (inclusion deficit is already in percentage units; weight 1, no constant needed)

// Card-fit sub-score penalties
const MISFIT_PENALTY_PER = 8; // points subtracted per misfit
const MISFIT_PENALTY_CAP = 40; // max penalty from misfits
const GAP_PENALTY_PER = 1.5; // points subtracted per gap card
const GAP_PENALTY_CAP = 20; // max penalty from gaps

const SUPERTYPES = new Set(['Legendary', 'Basic', 'Snow', 'Tribal', 'World', 'Token', 'Ongoing']);

const ROLE_LABELS: Record<RoleKey, string> = {
  ramp: 'Ramp',
  removal: 'Removal',
  boardwipe: 'Board Wipes',
  cardDraw: 'Card Advantage',
};

export type MisfitReasonKind =
  | 'inclusion-low' // present in EDHREC data but below floor
  | 'inclusion-absent' // not in EDHREC data at all (treat as 0%)
  | 'synergy-low' // synergy value ≤ 0
  | 'synergy-absent' // synergy not available (card not on commander's page)
  | 'role-missing' // no tagger role
  | 'theme-off'; // not in any active theme bucket

export interface MisfitReason {
  /** Discriminator — drives copy variants and visual treatment downstream. */
  kind: MisfitReasonKind;
  /** Short label, e.g. "Played in 2% of decklists". */
  label: string;
  /** Citation text, e.g. "Below the inclusion floor (5%)". */
  detail: string;
}

export interface Misfit {
  card: ScryfallCard;
  /** Higher = worse fit. */
  misfitScore: number;
  reasons: MisfitReason[];
  suggestedReplacement?: GapAnalysisCard;
}

/** True for lands (front face or land-back MDFCs) and basic lands. */
function isAnyLand(card: ScryfallCard): boolean {
  if (isBasicLandName(card.name)) return true;
  if (getFrontFaceTypeLine(card).toLowerCase().includes('land')) return true;
  return isMdfcLand(card);
}

/** Primary card type, ignoring supertypes (Legendary, Basic, …) and subtypes. */
function primaryType(typeLine: string): string {
  const beforeDash = typeLine.split('—')[0].trim();
  const tokens = beforeDash.split(/\s+/).filter(Boolean);
  while (tokens.length > 0 && SUPERTYPES.has(tokens[0])) tokens.shift();
  return tokens[0] ?? '';
}

export interface MisfitInputs {
  /** Cards currently in the deck (excluding commander). */
  cards: ScryfallCard[];
  /** Per-card EDHREC inclusion % for cards in the deck (keyed by card name). */
  cardInclusionMap: Record<string, number>;
  /** Per-card EDHREC synergy keyed by card name. Optional. */
  cardSynergyMap?: Record<string, number>;
  /**
   * Active-theme membership: lowercased card name → true. Optional —
   * when omitted the theme reason is skipped gracefully.
   */
  themeByCard?: Set<string> | null;
  /** Gap candidates (top EDHREC cards not in deck) — used for replacement suggestion. */
  gapCandidates?: GapAnalysisCard[];
  /** Commander name(s) — never suggest these as replacements. */
  commanderNames?: string[];
}

export function computeMisfits(inputs: MisfitInputs): Misfit[] {
  const { cards, cardInclusionMap, cardSynergyMap, themeByCard, gapCandidates } = inputs;

  const misfits: Misfit[] = [];

  const excludeBase = new Set<string>();
  for (const c of cards) excludeBase.add(c.name);
  for (const n of inputs.commanderNames ?? []) excludeBase.add(n);

  for (const card of cards) {
    if (isAnyLand(card)) continue; // lands evaluated separately, not as misfits here

    const reasons: MisfitReason[] = [];

    const incl = cardInclusionMap[card.name];
    if (incl == null) {
      reasons.push({
        kind: 'inclusion-absent',
        label: "Not played in this commander's decks",
        detail: 'Card has no inclusion data on EDHREC for this commander',
      });
    } else if (incl < INCLUSION_LOW) {
      reasons.push({
        kind: 'inclusion-low',
        label: `Played in ${incl.toFixed(0)}% of decklists`,
        detail: `Below the inclusion floor (${INCLUSION_LOW}%)`,
      });
    }

    const syn = cardSynergyMap?.[card.name];
    if (syn == null) {
      reasons.push({
        kind: 'synergy-absent',
        label: 'No commander synergy data',
        detail: "Card isn't on this commander's EDHREC page",
      });
    } else if (syn <= SYNERGY_LOW) {
      reasons.push({
        kind: 'synergy-low',
        label: 'Low commander synergy',
        detail: `EDHREC synergy ${syn >= 0 ? '+' : ''}${syn.toFixed(2)} for this commander`,
      });
    }

    const role = getCardRole(card.name);
    if (!role) {
      reasons.push({
        kind: 'role-missing',
        label: 'No tagged role',
        detail: "Doesn't fill ramp / removal / draw / wipe",
      });
    }

    // Theme reason only when we actually have theme membership to compare against.
    if (themeByCard && themeByCard.size > 0 && !themeByCard.has(card.name.toLowerCase())) {
      reasons.push({
        kind: 'theme-off',
        label: 'Off detected themes',
        detail: 'Not in any active theme bucket',
      });
    }

    if (reasons.length >= MISFIT_REASON_THRESHOLD) {
      const misfitScore =
        reasons.length * MISFIT_REASON_WEIGHT +
        (incl != null ? Math.max(0, INCLUSION_LOW - incl) : 0) +
        (syn != null ? Math.max(0, -syn * MISFIT_SYNERGY_WEIGHT) : 0);
      const excludeNames = new Set(excludeBase);
      excludeNames.add(card.name);
      const suggestedReplacement = pickReplacement(card, role, gapCandidates, excludeNames);
      misfits.push({ card, misfitScore, reasons, suggestedReplacement });
    }
  }

  // Highest misfitScore first.
  misfits.sort((a, b) => b.misfitScore - a.misfitScore);
  return misfits;
}

/** Pick a replacement from gap candidates: same role first, else same primary type. */
export function pickReplacement(
  card: ScryfallCard,
  role: RoleKey | null,
  gapCandidates: GapAnalysisCard[] | undefined,
  excludeNames: Set<string>
): GapAnalysisCard | undefined {
  if (!gapCandidates || gapCandidates.length === 0) return undefined;
  const candidates = gapCandidates.filter((g) => !excludeNames.has(g.name));
  if (candidates.length === 0) return undefined;
  if (role) {
    const sameRole = candidates.find((g) => g.role === role);
    if (sameRole) return sameRole;
  }
  const cardPrimary = primaryType(card.type_line ?? '');
  if (cardPrimary) {
    const sameType = candidates.find(
      (g) => primaryType(g.typeLine).toLowerCase() === cardPrimary.toLowerCase()
    );
    if (sameType) return sameType;
  }
  return undefined;
}

export interface CardFitSubscore {
  value: number;
  surface: string;
  bandLabel: string;
}

/** Inverse fit score: more misfits + more unfilled gaps = worse. */
export function computeCardFitSubscore(misfits: Misfit[], gapCount: number): CardFitSubscore {
  const misfitPenalty = Math.min(MISFIT_PENALTY_CAP, misfits.length * MISFIT_PENALTY_PER);
  const gapPenalty = Math.min(GAP_PENALTY_CAP, gapCount * GAP_PENALTY_PER);
  const value = Math.max(0, 100 - misfitPenalty - gapPenalty);
  const surface =
    misfits.length === 0 && gapCount === 0
      ? 'Every card pulls its weight.'
      : `${misfits.length} misfit${misfits.length === 1 ? '' : 's'} · ${gapCount} high-value gap${gapCount === 1 ? '' : 's'}`;
  return { value, surface, bandLabel: bandForCardFit(value) };
}

function bandForCardFit(score: number): string {
  if (score >= 90) return 'Tight';
  if (score >= 75) return 'Healthy';
  if (score >= 60) return 'Solid';
  if (score >= 40) return 'Loose';
  return 'Bloated';
}

export { ROLE_LABELS };
