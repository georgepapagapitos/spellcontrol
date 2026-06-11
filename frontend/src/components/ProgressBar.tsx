import { MeterBar } from './shared/MeterBar';

interface Props {
  /** 0-100. Ignored when indeterminate. */
  percent?: number;
  /** Optional caption shown below the bar. */
  message?: string;
  /** Show a looping animation instead of a fixed fill. */
  indeterminate?: boolean;
  className?: string;
}

export function ProgressBar({ percent = 0, message, indeterminate = false, className }: Props) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div
      className={`progress-bar${className ? ` ${className}` : ''}`}
      role="status"
      aria-live="polite"
    >
      <MeterBar
        value={clamped}
        max={100}
        size="md"
        minPct={2}
        indeterminate={indeterminate}
        role="progressbar"
      />
      {message && <div className="progress-bar-msg">{message}</div>}
    </div>
  );
}
