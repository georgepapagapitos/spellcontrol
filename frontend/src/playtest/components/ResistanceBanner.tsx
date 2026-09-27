import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '@/components/shared/Button';

interface Props {
  message: string;
  onDismiss(): void;
}

/**
 * Announcement banner for Resistance-mode opponent actions ("Opponent casts
 * Counterspell — …"). Auto-dismisses after a few seconds; also manually
 * dismissible. The parent keys this component by event id so a repeated
 * identical message remounts and re-announces via the status live region.
 */
const AUTO_DISMISS_MS = 4000;

export function ResistanceBanner({ message, onDismiss }: Props) {
  // Timer is mount-scoped (the parent keys us by event id, so each event gets
  // a fresh mount). Reading onDismiss through a ref keeps a re-render of the
  // parent — which recreates the callback — from restarting the countdown.
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);
  useEffect(() => {
    const t = setTimeout(() => onDismissRef.current(), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="playtest-resistance-banner" role="status">
      <span className="playtest-resistance-banner__message">{message}</span>
      <IconButton
        className="playtest-resistance-banner__dismiss"
        label="Dismiss opponent announcement"
        onClick={onDismiss}
        icon={<X width={14} height={14} strokeWidth={2} />}
      />
    </div>
  );
}
