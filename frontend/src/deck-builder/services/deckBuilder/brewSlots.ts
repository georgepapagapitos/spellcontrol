// Brew mode's slot-sequencing + candidate-ranking engine. Pure and
// synchronous (all inputs are already-fetched EDHREC data) — no network
// calls here, so it's cheap to call on every accept/pass. Composes the
// existing generator engines (role targets, priority scoring, ownership
// boost) instead of re-deriving any of them; see cardPicking.ts,
// roleTargets.ts, categorize.ts.
import type { EDHRECCard, EDHRECCommanderData } from '@/deck-builder/types';
import { getCardRole, type RoleKey } from '@/deck-builder/services/tagger/client';
import { calculateCardPriority, OWNED_PRIORITY_BOOST } from './cardPicking';
import {
  getBaseRoleTargets,
  computeEdhrecRoleTargets,
  EDHREC_BLEND_WEIGHT,
  EDHREC_INCLUSION_THRESHOLD,
} from './roleTargets';
import { isBasicLandName } from '@/lib/allocations';

/** The four functional roles plus the three non-functional buckets Brew mode
 * walks through. Order here IS the slot order (mirrors the product spec:
 * Ramp → Card draw → Removal → Board wipes → Theme → Finishers → Flex). */
export const BREW_ROLE_ORDER: RoleKey[] = ['ramp', 'cardDraw', 'removal', 'boardwipe'];

export type BrewSlotKey = RoleKey | 'theme' | 'finishers' | 'flex';

export const BREW_SLOT_ORDER: BrewSlotKey[] = [...BREW_ROLE_ORDER, 'theme', 'finishers', 'flex'];

const ROLE_LABELS: Record<RoleKey, string> = {
  ramp: 'Ramp',
  cardDraw: 'Card Draw',
  removal: 'Removal',
  boardwipe: 'Board Wipes',
};

export interface BrewSlotDef {
  key: BrewSlotKey;
  label: string;
  /** Commander-vocab explanation of what this slot is for. */
  purpose: string;
  target: number;
}

export interface BrewCandidate {
  name: string;
  price: string | null;
  inclusion: number;
  synergy: number;
  typeLine: string;
  cmc?: number;
  imageUrl?: string;
  /** "Somewhere in the collection" (mirrors the generator's own owned-priority
   *  boost — see OWNED_PRIORITY_BOOST) — ranking-only. The row's ownership
   *  BADGE is a separate, allocation-aware lookup (owned-and-free vs
   *  committed-elsewhere vs unowned), computed live at render time; see
   *  `useBrewOwnership` in `BrewSlotPanel`. Don't use this field for the
   *  badge — a card can be "owned" here but every copy already claimed. */
  isOwned: boolean;
  role?: RoleKey;
  roleLabel?: string;
  isGameChanger?: boolean;
  isThemeSynergy?: boolean;
}

function edhrecPrice(card: EDHRECCard): string | null {
  if (card.prices?.tcgplayer?.price) return card.prices.tcgplayer.price.toFixed(2);
  if (card.prices?.cardkingdom?.price) return card.prices.cardkingdom.price.toFixed(2);
  return null;
}

/**
 * Which Brew slot a card belongs to. A tagger-classified role always wins
 * (ramp/removal/boardwipe/cardDraw); otherwise a Game Changer is a finisher,
 * theme-synergy is the theme package, everything else is flex.
 */
export function bucketForSlot(card: EDHRECCard, role: RoleKey | null): BrewSlotKey {
  if (role) return role;
  if (card.isGameChanger) return 'finishers';
  if (card.isThemeSynergyCard || (card.synergy ?? 0) > 0.3) return 'theme';
  return 'flex';
}

function toBrewCandidate(card: EDHRECCard, role: RoleKey | null, isOwned: boolean): BrewCandidate {
  return {
    name: card.name,
    price: edhrecPrice(card),
    inclusion: card.inclusion,
    synergy: card.synergy ?? 0,
    typeLine: card.primary_type ?? '',
    cmc: card.cmc,
    imageUrl: card.image_uris?.[0]?.normal,
    isOwned,
    role: role ?? undefined,
    roleLabel: role ? ROLE_LABELS[role] : undefined,
    isGameChanger: card.isGameChanger,
    isThemeSynergy: card.isThemeSynergyCard,
  };
}

/**
 * Blend format-baseline role targets with this commander's own EDHREC data —
 * the same inputs `getDynamicRoleTargets` uses, minus its archetype/pacing
 * refinement layer (which needs a converted `ThemeResult[]` + commander
 * profile that Brew mode's simpler preamble doesn't build). "Ramp: ~10"
 * grounded in real EDHREC counts is what a slot's purpose line needs; the
 * archetype nuance is a refinement Brew mode can pick up later if the flat
 * targets feel off in practice.
 * ponytail: skips archetype/pacing multipliers — add if brewed decks
 * systematically under/over-shoot a role for a given archetype.
 */
export function computeBrewRoleTargets(
  edhrecData: EDHRECCommanderData,
  nonlandTotal: number
): Record<RoleKey, number> {
  const base = getBaseRoleTargets(nonlandTotal);
  const edhrecCounts = computeEdhrecRoleTargets(edhrecData, EDHREC_INCLUSION_THRESHOLD);
  const targets = {} as Record<RoleKey, number>;
  for (const role of BREW_ROLE_ORDER) {
    const blended =
      EDHREC_BLEND_WEIGHT * edhrecCounts[role] + (1 - EDHREC_BLEND_WEIGHT) * base[role];
    targets[role] = Math.max(role === 'boardwipe' ? 0 : 1, Math.round(blended));
  }
  return targets;
}

function slotPurpose(key: BrewSlotKey, target: number, themeLabel?: string): string {
  switch (key) {
    case 'ramp':
      return `Commander decks want mana ahead of curve — rocks, dorks, and land ramp. Most tables run about ${target}.`;
    case 'cardDraw':
      return `Card advantage keeps your hand full after wipes and removal wars. Aim for around ${target}.`;
    case 'removal':
      return `Spot removal answers one problem permanent at a time. A typical build runs about ${target}.`;
    case 'boardwipe':
      return `Board wipes reset a game that's gotten away from you. A few go a long way — around ${target}.`;
    case 'theme':
      return themeLabel
        ? `The ${themeLabel} package — the cards that make this deck feel like itself.`
        : `Your commander's signature synergy — the cards that make this deck feel like itself.`;
    case 'finishers':
      return `The cards that actually win the game — your finishers and wincons.`;
    case 'flex':
      return `Flex slots — utility, value, and anything else worth a seat in the 99.`;
  }
}

function slotLabel(key: BrewSlotKey, themeLabel?: string): string {
  if (key === 'theme') return themeLabel ? `${themeLabel} package` : 'Theme package';
  if (key === 'finishers') return 'Finishers';
  if (key === 'flex') return 'Flex & Utility';
  return ROLE_LABELS[key];
}

export interface BuildBrewSlotPlanOptions {
  roleTargets: Record<RoleKey, number>;
  nonlandTotal: number;
  hasTheme: boolean;
  themeLabel?: string;
}

/**
 * Build the ordered slot plan. Role slots get the blended EDHREC/format
 * target directly; the remaining budget (nonlandTotal minus the four role
 * targets) is split across theme/finishers/flex by a fixed, simple ratio —
 * flex's target is a starting estimate only, the page recomputes it live off
 * however much budget actually remains once earlier slots are filled/skipped.
 * ponytail: fixed 45/20/rest split, not commander-tuned; good enough for a
 * starting rail, the live "toward 99" total is what actually matters.
 */
export function buildBrewSlotPlan(opts: BuildBrewSlotPlanOptions): BrewSlotDef[] {
  const { roleTargets, nonlandTotal, hasTheme, themeLabel } = opts;
  const roleSum = BREW_ROLE_ORDER.reduce((sum, r) => sum + roleTargets[r], 0);
  const remaining = Math.max(0, nonlandTotal - roleSum);
  const themeTarget = hasTheme ? Math.round(remaining * 0.45) : 0;
  const finishersTarget = Math.min(8, Math.max(3, Math.round(remaining * 0.2)));
  const flexTarget = Math.max(0, remaining - themeTarget - finishersTarget);

  const slots: BrewSlotDef[] = BREW_ROLE_ORDER.map((role) => ({
    key: role,
    label: slotLabel(role),
    purpose: slotPurpose(role, roleTargets[role]),
    target: roleTargets[role],
  }));

  if (hasTheme) {
    slots.push({
      key: 'theme',
      label: slotLabel('theme', themeLabel),
      purpose: slotPurpose('theme', themeTarget, themeLabel),
      target: themeTarget,
    });
  }

  slots.push({
    key: 'finishers',
    label: slotLabel('finishers'),
    purpose: slotPurpose('finishers', finishersTarget),
    target: finishersTarget,
  });

  slots.push({
    key: 'flex',
    label: slotLabel('flex'),
    purpose: slotPurpose('flex', flexTarget),
    target: flexTarget,
  });

  return slots;
}

/**
 * Rank and slice the top `count` candidates for a slot from the commander's
 * full non-land pool. Reuses the generator's own priority formula
 * (`calculateCardPriority` + the owned-card tie-break) — Brew mode doesn't
 * re-score cards, it just narrows the pool to one slot at a time.
 */
export function pickBrewCandidates(
  pool: readonly EDHRECCard[],
  slotKey: BrewSlotKey,
  excludeNames: ReadonlySet<string>,
  collectionNames: ReadonlySet<string> | undefined,
  count: number
): BrewCandidate[] {
  const scored: { card: EDHRECCard; role: RoleKey | null; score: number }[] = [];
  for (const card of pool) {
    if (isBasicLandName(card.name) || excludeNames.has(card.name)) continue;
    const role = getCardRole(card.name);
    if (bucketForSlot(card, role) !== slotKey) continue;
    const owned = collectionNames?.has(card.name) ?? false;
    const score = calculateCardPriority(card) + (owned ? OWNED_PRIORITY_BOOST : 0);
    scored.push({ card, role, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored
    .slice(0, count)
    .map(({ card, role }) => toBrewCandidate(card, role, collectionNames?.has(card.name) ?? false));
}

/** Tally accepted candidates by functional role, for the progress rail and
 * (later) a real role-deficit boost if slot-internal ranking ever needs it. */
export function tallyRoleCounts(accepted: readonly BrewCandidate[]): Record<RoleKey, number> {
  const counts: Record<RoleKey, number> = { ramp: 0, removal: 0, boardwipe: 0, cardDraw: 0 };
  for (const c of accepted) {
    if (c.role) counts[c.role]++;
  }
  return counts;
}

/** Flatten every accepted candidate across all slots, in slot order — the
 * name list Brew mode needs to resolve full ScryfallCards (for the running
 * curve panel and the manabase step) and to save the final deck. */
export function flattenAccepted(
  accepted: Readonly<Record<string, BrewCandidate[]>>,
  slots: readonly BrewSlotDef[]
): BrewCandidate[] {
  const out: BrewCandidate[] = [];
  for (const slot of slots) {
    out.push(...(accepted[slot.key] ?? []));
  }
  return out;
}
