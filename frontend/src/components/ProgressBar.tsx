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
  const fillStyle = indeterminate ? undefined : { width: `${Math.max(2, clamped)}%` };
  return (
    <div
      className={`progress-bar${className ? ` ${className}` : ''}`}
      role="status"
      aria-live="polite"
    >
      <div
        className="progress-bar-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : clamped}
      >
        <div
          className={`progress-bar-fill${indeterminate ? ' progress-bar-fill-indeterminate' : ''}`}
          style={fillStyle}
        />
      </div>
      {message && <div className="progress-bar-msg">{message}</div>}
    </div>
  );
}
