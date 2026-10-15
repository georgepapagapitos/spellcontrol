import { Button } from '@/components/shared/Button';
import './filter-kit.css';

export interface ShowResultsButtonProps {
  /** Matches right now; `null` while it is still being counted. */
  count: number | null;
  onClick: () => void;
  /** The thing counted, singular. Default "card". */
  noun?: string;
  /** Its plural when it is not the noun plus s ("deck" is fine, "person" is not). */
  plural?: string;
}

/**
 * The apply button of a dialog or sheet that holds a draft: "Show 412 cards",
 * singular at one, and "No cards match" at zero in the danger tone, never the
 * primary look. Announced politely so a changing count is heard without
 * stealing focus.
 */
export function ShowResultsButton({
  count,
  onClick,
  noun = 'card',
  plural = `${noun}s`,
}: ShowResultsButtonProps) {
  const zero = count === 0;
  const label =
    count === null
      ? `Show ${plural}`
      : zero
        ? `No ${plural} match`
        : `Show ${count.toLocaleString()} ${count === 1 ? noun : plural}`;
  return (
    <span className="filter-kit-show" aria-live="polite">
      <Button variant={zero ? 'danger' : 'primary'} onClick={onClick}>
        {label}
      </Button>
    </span>
  );
}
