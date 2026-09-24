import { useEffect, useRef } from 'react';
import { haptics } from '@/lib/haptics';

/** What the tab reads while your turn waits in the background. */
export const TURN_TITLE_PREFIX = '● Your turn · ';

let audio: AudioContext | null = null;

/**
 * Two short rising notes, synthesised rather than shipped as a file: no asset
 * on the boot path, nothing to decode. The page already has the user's
 * gesture by the time a turn can pass to them, so the context is allowed to
 * start even from a background tab.
 */
function playChime(): void {
  try {
    if (typeof AudioContext === 'undefined') return;
    audio ??= new AudioContext();
    const ctx = audio;
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime;
    [660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = t + i * 0.12;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.15, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.26);
    });
  } catch {
    // No audio device, or a browser that refuses: the title still says it.
  }
}

function clearTitle(): void {
  if (document.title.startsWith(TURN_TITLE_PREFIX)) {
    document.title = document.title.slice(TURN_TITLE_PREFIX.length);
  }
}

/**
 * The turn alert: when the turn passes TO you, a chime and a buzz, and, if
 * the tab is in the background, a title that says so until you come back.
 *
 * Fires on the transition only. Mounting on your own turn (joining, a
 * reload) is not news, so it stays quiet; so does a turn that stays yours.
 * The title prefix is stripped rather than a saved title restored, so a
 * route that retitles the page meanwhile keeps its own title.
 */
export function useTurnAlert(myTurn: boolean, enabled: boolean): void {
  const wasMine = useRef(myTurn);

  useEffect(() => {
    const was = wasMine.current;
    wasMine.current = myTurn;
    if (!myTurn) {
      clearTitle();
      return;
    }
    if (was || !enabled) return;
    playChime();
    haptics.tap();
    if (document.hidden && !document.title.startsWith(TURN_TITLE_PREFIX)) {
      document.title = TURN_TITLE_PREFIX + document.title;
    }
  }, [myTurn, enabled]);

  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) clearTitle();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearTitle();
    };
  }, []);
}
