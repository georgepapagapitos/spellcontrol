import { useState } from 'react';
import { Smartphone } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { useMediaQuery } from '@/lib/use-media-query';
import { PHONE_MAX_WIDTH } from '../hooks/use-narrow-viewport';

/** A phone held upright. `pointer: coarse` keeps a narrow desktop window out:
 *  it can't be turned, so asking it to is noise. */
const UPRIGHT_PHONE = `(orientation: portrait) and (max-width: ${PHONE_MAX_WIDTH}px) and (pointer: coarse)`;

/** Session-scoped on purpose: skipped once, quiet for the rest of the visit,
 *  offered again next visit. */
const SKIP_KEY = 'spellcontrol:playtest:rotate-skipped';

function wasSkipped(): boolean {
  try {
    return sessionStorage.getItem(SKIP_KEY) === '1';
  } catch {
    return false;
  }
}

interface Props {
  /** The board's mirror of `document.fullscreenElement`. */
  fullscreen: boolean;
}

/**
 * Asks a phone held upright to turn sideways, where the table has room. A
 * suggestion, not a wall: the upright layout works, so "Play upright" (or
 * Escape, or the backdrop) leaves it for the rest of the visit, and turning
 * the phone clears it on its own because the query stops matching.
 *
 * Android Chrome only lets a page lock its orientation once it is fullscreen,
 * so "Go fullscreen" is also what turns the table for you there. iPhone
 * Safari offers neither, so the button is absent and the prompt just asks.
 */
export function RotatePrompt({ fullscreen }: Props) {
  const upright = useMediaQuery(UPRIGHT_PHONE);
  const [skipped, setSkipped] = useState(wasSkipped);
  if (!upright || skipped) return null;

  const skip = () => {
    try {
      sessionStorage.setItem(SKIP_KEY, '1');
    } catch {
      // Unwritable storage just means the prompt comes back on reload.
    }
    setSkipped(true);
  };

  const goFullscreen = async () => {
    try {
      await document.documentElement.requestFullscreen();
      await screen.orientation.lock('landscape');
    } catch {
      // No lock on this browser: fullscreen still happened (or was refused),
      // and the prompt stays until the phone is turned.
    }
  };

  const canFullscreen =
    typeof document !== 'undefined' && document.fullscreenEnabled && !fullscreen;

  return (
    <Modal
      onClose={skip}
      labelledBy="playtest-rotate-title"
      className="playtest-rotate"
      backdropClassName="playtest-rotate-backdrop"
    >
      <Smartphone className="playtest-rotate__icon" size={48} aria-hidden="true" />
      <h2 id="playtest-rotate-title" className="playtest-rotate__title">
        Turn your phone sideways
      </h2>
      <p className="playtest-rotate__body">The battlefield gets the whole width.</p>
      {canFullscreen && (
        <button type="button" className="btn btn-primary" onClick={() => void goFullscreen()}>
          Go fullscreen
        </button>
      )}
      <button type="button" className="btn-link playtest-rotate__skip" onClick={skip}>
        Play upright
      </button>
    </Modal>
  );
}
