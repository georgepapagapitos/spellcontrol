import './ValidationChecklist.css';
import type {
  CheckStatus,
  ValidationResult,
} from '@/deck-builder/services/deckBuilder/validationChecklist';
import { VerdictBadge, type VerdictTone } from './VerdictBadge';

const STATUS_GLYPH: Record<CheckStatus, string> = { pass: '✓', warn: '▾', fail: '✗' };
const STATUS_WORD: Record<CheckStatus, string> = { pass: 'Pass', warn: 'Short', fail: 'Fail' };

/** Roll the checklist up into one headline verdict chip. */
function summarize(result: ValidationResult): { tone: VerdictTone; label: string; reason: string } {
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

/**
 * The deck-validation checklist: a headline VerdictBadge over a pass/fail list
 * of deck-health gates (legality + role/curve targets). Presentational — the
 * checks are computed by buildValidationChecklist().
 */
export function ValidationChecklist({ result }: { result: ValidationResult }): JSX.Element | null {
  if (result.checks.length === 0) return null;
  const summary = summarize(result);

  return (
    <div className="validation-checklist">
      <VerdictBadge
        tone={summary.tone}
        label={summary.label}
        reason={summary.reason}
        className="validation-summary"
      />
      <ul className="validation-list">
        {result.checks.map((c) => (
          <li key={c.id} className={`validation-row is-${c.status}`}>
            <span className="validation-glyph" aria-label={STATUS_WORD[c.status]}>
              {STATUS_GLYPH[c.status]}
            </span>
            <span className="validation-label">{c.label}</span>
            <span className="validation-detail">{c.detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
