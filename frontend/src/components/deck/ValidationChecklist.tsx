import './ValidationChecklist.css';
import type {
  CheckStatus,
  ValidationResult,
} from '@/deck-builder/services/deckBuilder/validationChecklist';
import { summarizeValidation } from '@/deck-builder/services/deckBuilder/validationChecklist';
import { VerdictBadge } from './VerdictBadge';

const STATUS_GLYPH: Record<CheckStatus, string> = { pass: '✓', warn: '▾', fail: '✗' };
const STATUS_WORD: Record<CheckStatus, string> = { pass: 'Pass', warn: 'Short', fail: 'Fail' };

/**
 * The deck-validation checklist: a headline VerdictBadge over a pass/fail list
 * of deck-health gates (legality + role/curve targets). Presentational — the
 * checks are computed by buildValidationChecklist().
 */
export function ValidationChecklist({ result }: { result: ValidationResult }): JSX.Element | null {
  if (result.checks.length === 0) return null;
  const summary = summarizeValidation(result);

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
