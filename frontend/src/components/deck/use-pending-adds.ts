import { useRef, useState } from 'react';

/** Names whose add is still resolving the card. A lookup parked behind
 *  Scryfall's 429 cooldown can sit for tens of seconds, so the pressed row shows
 *  it is working and a repeat press (or Enter) does not queue a second add. */
export function usePendingAdds(atCopyLimit: (name: string) => boolean) {
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const inFlight = useRef(new Set<string>());
  const track = async (name: string, run: () => Promise<void>) => {
    // The button is disabled at the cap, but the row is also reachable by the
    // list's Enter handler and by the preview carousel's add action, so the
    // refusal lives at the one choke point every path goes through.
    if (atCopyLimit(name) || inFlight.current.has(name)) return;
    inFlight.current.add(name);
    setPending(new Set(inFlight.current));
    try {
      await run();
    } finally {
      inFlight.current.delete(name);
      setPending(new Set(inFlight.current));
    }
  };
  return { isPending: (name: string) => pending.has(name), track };
}
