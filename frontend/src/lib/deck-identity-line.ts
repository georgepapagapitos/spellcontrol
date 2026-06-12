import { BRACKET_LABELS } from '@/deck-builder/services/deckBuilder/bracketEstimator';
import type { DeckIdentity } from '@/deck-builder/services/deckBuilder/deckIdentity';
import {
  summarizeValidation,
  type ValidationResult,
  type ValidationTone,
} from '@/deck-builder/services/deckBuilder/validationChecklist';

export interface IdentitySegment {
  kind: 'archetype' | 'bracket' | 'validation';
  text: string;
  /** Tone for the validation segment (tints the rendered text). Absent on other kinds. */
  tone?: ValidationTone;
  /** Secondary text shown via InfoTip, not inline. Only on 'bracket'. */
  tipText?: string;
}

export interface IdentityLineInput {
  /** From deriveDeckIdentity() — null when no commander (non-commander format). */
  identity: DeckIdentity | null;
  /** Format label for the fallback when no identity (e.g. "Commander", "Standard"). */
  formatLabel: string;
  /** The effective bracket number (1-5) or undefined when no bracket computed yet. */
  bracket?: number;
  /** The validation result to summarize. */
  validation: ValidationResult;
}

/**
 * Composes the one-line identity verdict as an ordered array of segments.
 * The component can drop trailing segments responsively (320px keeps archetype only).
 * Band words only — no raw scores in the line.
 */
export function buildIdentityLine(input: IdentityLineInput): IdentitySegment[] {
  const { identity, formatLabel, bracket, validation } = input;
  const segments: IdentitySegment[] = [];

  // Archetype segment — always first
  if (identity) {
    const text = `${identity.pacingShort} ${identity.archetypeLabel} deck`;
    segments.push({ kind: 'archetype', text });
  } else {
    segments.push({ kind: 'archetype', text: `${formatLabel} deck` });
  }

  // Bracket segment — only when bracket is known
  if (bracket !== undefined) {
    const tierWord = BRACKET_LABELS[bracket] ?? String(bracket);
    segments.push({
      kind: 'bracket',
      text: `Bracket ${bracket}`,
      tipText: tierWord,
    });
  }

  // Validation segment — always present (summarize)
  const verdict = summarizeValidation(validation);
  segments.push({
    kind: 'validation',
    text: verdict.label,
    tone: verdict.tone,
  });

  return segments;
}
