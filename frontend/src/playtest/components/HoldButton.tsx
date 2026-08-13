import { useHold } from '../hooks/use-hold';
import './HoldButton.css';

/**
 * Online-only "Hold — anyone respond?" trigger (T101), mounted in
 * ActionBar's online-only cluster next to `<ReactionPicker>`. Self-gates via
 * `useHold` the same way `<ReactionPicker>`/`<TableSignals>` self-gate via
 * `useOnlineSignals` — renders nothing in solo playtest, since there's no
 * table to pause for. One tap raises a hold with the server's own default
 * summary ("wants to respond"); while this seat's own hold is pending, the
 * same button becomes the release control. The table-wide view — every
 * seat's active hold, including this one — is `<HoldBanner>`.
 */
export function HoldButton() {
  const hold = useHold();
  if (!hold) return null;

  return (
    <button
      type="button"
      className={`playtest-hold-button${hold.pending ? ' is-pending' : ''}`}
      aria-pressed={hold.pending !== null}
      onClick={hold.toggle}
      title={hold.pending ? 'Release the hold' : 'Hold — ask the table to wait a beat'}
    >
      {hold.pending ? 'Holding — release' : 'Hold'}
    </button>
  );
}
