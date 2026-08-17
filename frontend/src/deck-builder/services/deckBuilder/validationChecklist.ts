import { isBasicLandName } from '@/lib/allocations';
import type { DeckFormatConfig } from '@/deck-builder/types';

/** A single deck-health gate. `fail` = hard rule (legality); `warn` = soft target. */
export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface ValidationCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface ValidationResult {
  checks: ValidationCheck[];
  passCount: number;
  total: number;
  /** Hard-rule failures (size / identity / singleton). */
  hardFails: number;
  /** Soft-target shortfalls (role counts / curve). */
  softWarns: number;
}

/**
 * The verdict tone vocabulary the roll-up emits. Defined here (not imported from
 * the component layer) so the service stays UI-free; VerdictBadge's `VerdictTone`
 * is a superset, so these values stay assignable to it at the call sites.
 */
export type ValidationTone = 'success' | 'warn' | 'err';

export interface ValidationSummary {
  tone: ValidationTone;
  label: string;
  reason: string;
}

/**
 * Roll the checklist up into one headline verdict: tone + a short label
 * ("All clear" / "N to tune" / "N to fix") + the pass-ratio reason. Shared by the
 * ValidationChecklist chip and the Stats-tab hero so there's one verdict roll-up.
 */
export function summarizeValidation(result: ValidationResult): ValidationSummary {
  const { passCount, total, hardFails, softWarns } = result;
  const reason = `${passCount} of ${total} checks pass.`;
  if (hardFails > 0) {
    return { tone: 'err', label: `${hardFails} to fix`, reason };
  }
  if (softWarns > 0) {
    return { tone: 'warn', label: `${softWarns} to tune`, reason };
  }
  return { tone: 'success', label: 'All clear', reason };
}

export interface ValidationInput {
  /** The full deck incl. commander(s) — each card's name / type_line / cmc / color_identity. */
  cards: Array<{ name: string; type_line?: string; cmc?: number; color_identity?: string[] }>;
  /** The deck's legal color identity (commander union). Omit to skip the identity gate. */
  commanderIdentity?: string[];
  roleCounts?: Record<string, number>;
  roleTargets?: Record<string, number>;
  /** Average mana value of the deck (from the mana analysis). */
  averageCmc?: number;
  /** The deck's format rules — total size (commander[s] included) and the
   *  per-name copy limit. Omit to gate as Commander (100 cards, singleton). */
  format?: Pick<DeckFormatConfig, 'deckSize' | 'maxCopies'>;
}

/** Decks with an average MV above this read as top-heavy. Mirrors the bracket
 *  estimator's low-curve threshold so the two agree on "fast enough". */
const CURVE_AVG_MAX = 3.5;
/** Fallback format rules when no config is passed: Commander (commander[s] + 99). */
const DEFAULT_FORMAT: Required<ValidationInput>['format'] = { deckSize: 100, maxCopies: 1 };

/** Tolerant role lookup — counts/targets share keys but casing varies by source. */
function roleValue(map: Record<string, number> | undefined, ...keys: string[]): number | undefined {
  if (!map) return undefined;
  for (const k of keys) if (typeof map[k] === 'number') return map[k];
  return undefined;
}

/**
 * A pass/fail deck-health checklist for the Stats board: a legality gate
 * (size / color identity / singleton) plus the soft role + curve targets. Pure —
 * derived from the live card list and the role analysis, no decision logic.
 */
export function buildValidationChecklist(input: ValidationInput): ValidationResult {
  const { cards, commanderIdentity, roleCounts, roleTargets, averageCmc } = input;
  const { deckSize, maxCopies } = input.format ?? DEFAULT_FORMAT;
  const checks: ValidationCheck[] = [];

  // ── Hard rules ──────────────────────────────────────────────────────────
  const size = cards.length;
  checks.push({
    id: 'size',
    label: 'Deck size',
    status: size === deckSize ? 'pass' : 'fail',
    detail: `${size} / ${deckSize} cards`,
  });

  if (commanderIdentity) {
    const legal = new Set(commanderIdentity);
    const offColor = cards.filter((c) => (c.color_identity ?? []).some((k) => !legal.has(k)));
    checks.push({
      id: 'identity',
      label: 'Commander identity',
      status: offColor.length === 0 ? 'pass' : 'fail',
      detail:
        offColor.length === 0
          ? 'every card within identity'
          : `${offColor.length} off-color card${offColor.length === 1 ? '' : 's'}`,
    });
  }

  const nameCounts = new Map<string, number>();
  for (const c of cards) {
    if (isBasicLandName(c.name)) continue; // basics may repeat
    nameCounts.set(c.name, (nameCounts.get(c.name) ?? 0) + 1);
  }
  const over = [...nameCounts.values()].filter((n) => n > maxCopies).length;
  checks.push({
    id: 'singleton',
    label: maxCopies === 1 ? 'Singleton' : 'Copy limit',
    status: over === 0 ? 'pass' : 'fail',
    detail:
      over === 0
        ? maxCopies === 1
          ? 'no duplicates'
          : `max ${maxCopies} copies of a card`
        : maxCopies === 1
          ? `${over} duplicate name${over === 1 ? '' : 's'}`
          : `${over} name${over === 1 ? '' : 's'} over ${maxCopies} copies`,
  });

  // ── Soft targets ────────────────────────────────────────────────────────
  const roleSpecs: Array<{ id: string; label: string; have?: number; want?: number }> = [
    {
      id: 'ramp',
      label: 'Ramp count',
      have: roleValue(roleCounts, 'ramp'),
      want: roleValue(roleTargets, 'ramp'),
    },
    {
      id: 'removal',
      label: 'Removal count',
      have: roleValue(roleCounts, 'singleRemoval', 'removal'),
      want: roleValue(roleTargets, 'singleRemoval', 'removal'),
    },
    {
      id: 'cardDraw',
      label: 'Card draw count',
      have: roleValue(roleCounts, 'cardDraw', 'cardAdvantage'),
      want: roleValue(roleTargets, 'cardDraw', 'cardAdvantage'),
    },
    {
      id: 'boardwipe',
      label: 'Board wipe count',
      have: roleValue(roleCounts, 'boardWipes', 'boardwipe'),
      want: roleValue(roleTargets, 'boardWipes', 'boardwipe'),
    },
  ];
  for (const spec of roleSpecs) {
    if (typeof spec.want !== 'number') continue; // no target → nothing to gate
    const have = spec.have ?? 0;
    checks.push({
      id: spec.id,
      label: spec.label,
      status: have >= spec.want ? 'pass' : 'warn',
      detail: `${have} / ${spec.want}`,
    });
  }

  if (typeof averageCmc === 'number') {
    checks.push({
      id: 'curve',
      label: 'Curve',
      status: averageCmc <= CURVE_AVG_MAX ? 'pass' : 'warn',
      detail: `Avg MV ${averageCmc.toFixed(2)}`,
    });
  }

  const passCount = checks.filter((c) => c.status === 'pass').length;
  const hardFails = checks.filter((c) => c.status === 'fail').length;
  const softWarns = checks.filter((c) => c.status === 'warn').length;
  return { checks, passCount, total: checks.length, hardFails, softWarns };
}
