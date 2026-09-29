import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

const read = () => navigator.onLine !== false;

/**
 * Whether the browser reports a network connection, kept current as it comes
 * and goes. `navigator.onLine` only knows the device's own link, so `true` is
 * not a promise that a server answers; it is for hiding what can't work
 * offline, never for skipping error handling.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, read, () => true);
}
