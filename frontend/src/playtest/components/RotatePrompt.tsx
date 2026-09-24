import { useState } from 'react';
import { Smartphone } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { useMediaQuery } from '@/lib/use-media-query';
import { PHONE_MAX_WIDTH } from '../hooks/use-narrow-viewport';

/** A phone held upright. `pointer: coarse` keeps a narrow desktop window out:
 *  it can't be turned, so asking it to is noise. */
const UPRIGHT_PHONE = `(orientation: portrait) and (max-width: ${PHONE_MAX_WIDTH}px) and (pointer: coarse)`;

/** The same phone on its side. 500px clears the tallest phones on their side
 *  (about 430px) and stays under every tablet. */
const SIDEWAYS_PHONE = '(orientation: landscape) and (max-height: 500px) and (pointer: coarse)';

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
 * Gets a phone to the table's best shape: sideways and fullscreen. Upright,
 * it asks for the turn and offers fullscreen. Sideways, only the offer is
 * left, because the browser's own bars still take a big share of a screen
 * that is about 390px tall. Fullscreen or "Skip" ends it; Skip (or Escape, or
 * the backdrop) holds for the rest of the visit. A suggestion, not a wall:
 * the table works either way.
 *
 * Android Chrome only lets a page lock its orientation once it is fullscreen,
 * so "Go fullscreen" is also what turns the table for you there. iPhone
 * Safari offers neither, so upright it just asks, and sideways there is
 * nothing to offer and nothing shows.
 */
export function RotatePrompt({ fullscreen }: Props) {
  const upright = useMediaQuery(UPRIGHT_PHONE);
  const sideways = useMediaQuery(SIDEWAYS_PHONE);
  const [skipped, setSkipped] = useState(wasSkipped);

  const canFullscreen =
    typeof document !== 'undefined' && document.fullscreenEnabled && !fullscreen;
  if (skipped || !(upright || (sideways && canFullscreen))) return null;

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

  return (
    <Modal
      onClose={skip}
      labelledBy={upright ? 'playtest-rotate-title' : undefined}
      label={upright ? undefined : 'Play fullscreen'}
      className="playtest-rotate"
      backdropClassName="playtest-rotate-backdrop"
    >
      {upright && (
        <>
          <Smartphone className="playtest-rotate__icon" size={48} aria-hidden="true" />
          <h2 id="playtest-rotate-title" className="playtest-rotate__title">
            Turn your phone sideways
          </h2>
          <p className="playtest-rotate__body">The battlefield gets the whole width.</p>
        </>
      )}
      {canFullscreen && (
        <button type="button" className="btn btn-primary" onClick={() => void goFullscreen()}>
          Go fullscreen
        </button>
      )}
      <button type="button" className="btn-link playtest-rotate__skip" onClick={skip}>
        Skip
      </button>
    </Modal>
  );
}
