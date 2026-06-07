import type { JSX } from 'react';
import './VerdictBadge.css';

/**
 * The unified vocabulary for "what should I do with this card?" across the
 * Tune-board panels. Each verdict carries a default word + a theme tone:
 *
 *   add        → "Add"        success (green)  — a safe gain (Engine/Optimize adds, gap consider)
 *   cut        → "Cut"        err     (red)    — remove it (Optimize removals)
 *   substitute → "Substitute" info    (blue)   — lateral owned swap (Substitution rows)
 *   budget     → "Budget"     warn    (gold)   — a real tradeoff / power loss (Cost downgrades)
 *   owned      → "Owned"      accent           — already in your collection
 *   hold       → "Hold"       neutral          — flagged but intentionally kept
 *
 * Tones reuse the existing status tokens (defined since #424). Panels with a
 * finer-grained scale (e.g. the Cost panel's drop-in/sidegrade/budget
 * confidence) pass `tone` + `label` directly instead of a canonical verdict.
 *
 * Presentational only — it renders a chip (+ optional plain-English reason) and
 * holds no decision logic; callers map their own semantics onto the vocabulary.
 */
export type Verdict = 'add' | 'cut' | 'substitute' | 'budget' | 'owned' | 'hold';

export type VerdictTone = 'success' | 'info' | 'warn' | 'err' | 'accent' | 'neutral';

const VERDICT_PRESET: Record<Verdict, { label: string; tone: VerdictTone }> = {
  add: { label: 'Add', tone: 'success' },
  cut: { label: 'Cut', tone: 'err' },
  substitute: { label: 'Substitute', tone: 'info' },
  budget: { label: 'Budget', tone: 'warn' },
  owned: { label: 'Owned', tone: 'accent' },
  hold: { label: 'Hold', tone: 'neutral' },
};

export interface VerdictBadgeProps {
  /** Canonical verdict — sets the chip's tone and default word. */
  verdict?: Verdict;
  /** Tone override (defaults to the verdict's). Use when a panel has its own scale. */
  tone?: VerdictTone;
  /** Word override (defaults to the verdict's). e.g. Cost's "Drop-in" / "Sidegrade". */
  label?: string;
  /** Optional plain-English one-liner shown beside the chip. */
  reason?: string;
  /** Extra class on the wrapper (layout hook for the host panel). */
  className?: string;
}

/**
 * A verdict chip — a 999px pill in the verdict's tone — optionally followed by a
 * one-sentence reason. Mirrors the `.cost-badge` pill so it reads as one system.
 */
export function VerdictBadge({
  verdict,
  tone,
  label,
  reason,
  className,
}: VerdictBadgeProps): JSX.Element {
  const preset = verdict ? VERDICT_PRESET[verdict] : undefined;
  const resolvedTone = tone ?? preset?.tone ?? 'neutral';
  const word = label ?? preset?.label ?? '';

  return (
    <span className={`verdict-badge${className ? ` ${className}` : ''}`}>
      <span className={`verdict-chip is-${resolvedTone}`}>{word}</span>
      {reason && <span className="verdict-reason">{reason}</span>}
    </span>
  );
}
