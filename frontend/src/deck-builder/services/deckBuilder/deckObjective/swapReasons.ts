/**
 * The words a swap is stated in: its per-card reasons, the role counts it
 * moved and its one-line summary (split from optimizer.ts, which holds the
 * search itself). The reasons are re-checked against the final deck by
 * reasonCheck.ts.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import { isLandCard } from './context';
import { ROLE_LABEL } from './terms/roles';
import { countRoles } from './trustRegion';
import {
  OBJECTIVE_ROLES,
  TERM_KEYS,
  type ObjectiveContext,
  type ObjectiveDeck,
  type ObjectiveScore,
  type TermKey,
} from './types';

export interface SwapReason {
  name: string;
  term: TermKey;
  value: number;
  note: string;
  /** The cards the note lists, whole (see CardNote). */
  names?: string[];
}

export interface AppliedSwap {
  out: string[];
  in: string[];
  /** repair: taken because it breaks a hard constraint less, whatever it costs. */
  kind: 'improve' | 'combo' | 'escape' | 'repair';
  /** What the swap is worth in the returned deck: its score minus the same deck with this swap undone. */
  delta: number;
  /** Each term's contribution change, read the same way. */
  terms: Record<TermKey, number>;
  /** The per-card notes behind the change, read from the returned deck. */
  reasons: SwapReason[];
  /** One line. */
  summary: string;
  /** Set on a repair that had to leave the trust region: what it broke and why nothing owned fit inside. */
  disclosure?: string;
}

/** "draw 11 → 12 of target 12" for each role whose count the swap moved (from the roles term's summary). */
function rolesMoved(before: string, after: string): string | null {
  const parse = (s: string) =>
    new Map(
      [...s.matchAll(/(\w+) ([\d.]+)\/(\d+)/g)].map((m) => [m[1], { c: m[2], t: m[3] }] as const)
    );
  const a = parse(before);
  const b = parse(after);
  const moved: string[] = [];
  for (const [label, x] of b) {
    const y = a.get(label);
    if (y && y.c !== x.c) moved.push(`${label} ${y.c} → ${x.c} of target ${x.t}`);
  }
  return moved.length ? `roles: ${moved.join(', ')}` : null;
}

/**
 * "ramp 16 → 15 of target 11" for each role the swap moved, counted by the
 * report's own counter in the decks the swap was made between (the seed with
 * the swaps before it applied, and with it): a reason read against the final
 * deck alone would give every ramp cut the same last step.
 */
export function rolesMovedBetween(
  before: ObjectiveDeck,
  after: ObjectiveDeck,
  roleOf: (card: ScryfallCard) => string | null,
  targets: ObjectiveContext['roleTargets']
): string | null {
  const a = countRoles(
    { commanders: before.commanders, cards: before.cards.filter((c) => !isLandCard(c)) },
    roleOf
  );
  const b = countRoles(
    { commanders: after.commanders, cards: after.cards.filter((c) => !isLandCard(c)) },
    roleOf
  );
  const moved = OBJECTIVE_ROLES.filter((r) => targets[r] && (a[r] ?? 0) !== (b[r] ?? 0)).map(
    (r) => `${ROLE_LABEL[r]} ${a[r] ?? 0} → ${b[r] ?? 0} of target ${targets[r]}`
  );
  return moved.length ? `roles: ${moved.join(', ')}` : null;
}

export function reasonsFor(
  before: ObjectiveScore,
  after: ObjectiveScore,
  outs: string[],
  ins: string[],
  rolesNote?: string | null
): SwapReason[] {
  const out: SwapReason[] = [];
  for (const term of TERM_KEYS) {
    // A role's shortfall is shared by all its cards, so a per-card roles note
    // reads backwards on the card that fills it ("draw is short" on the draw
    // spell coming in). The role counts the swap moved say it instead.
    if (term === 'roles') continue;
    for (const n of after.terms[term].detail.cards)
      if (ins.includes(n.name))
        out.push({
          name: n.name,
          term,
          value: n.value * after.terms[term].weight,
          note: n.note,
          ...(n.names ? { names: n.names } : {}),
        });
    for (const n of before.terms[term].detail.cards)
      if (outs.includes(n.name))
        out.push({
          name: n.name,
          term,
          value: -n.value * before.terms[term].weight,
          note: n.note,
          ...(n.names ? { names: n.names } : {}),
        });
  }
  const roles =
    rolesNote !== undefined
      ? rolesNote
      : rolesMoved(before.terms.roles.detail.summary, after.terms.roles.detail.summary);
  if (roles && ins.length) {
    out.push({
      name: ins[0],
      term: 'roles',
      value: after.terms.roles.contribution - before.terms.roles.contribution,
      note: roles,
    });
  }
  return out
    .filter((r) => Math.abs(r.value) >= 0.005)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || a.name.localeCompare(b.name));
}

export function summaryOf(swap: Omit<AppliedSwap, 'summary'>): string {
  const top = TERM_KEYS.filter((k) => Math.abs(swap.terms[k]) >= 0.01)
    .sort((a, b) => Math.abs(swap.terms[b]) - Math.abs(swap.terms[a]))
    .slice(0, 3)
    .map((k) => `${k} ${swap.terms[k] >= 0 ? '+' : ''}${swap.terms[k].toFixed(2)}`);
  return `${swap.in.join(' + ')} for ${swap.out.join(' + ')}: ${swap.delta >= 0 ? '+' : ''}${swap.delta.toFixed(2)} (${top.join(', ')})`;
}
