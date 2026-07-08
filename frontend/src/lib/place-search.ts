/**
 * Place suggestions for the game-night "Where" field, via Photon
 * (photon.komoot.io) — an OSM geocoder built for as-you-type autocomplete:
 * free, keyless, CORS-enabled. Suggestions are strictly best-effort sugar; the
 * field stays free text, so "Sam's place" works whether or not the geocoder
 * knows it (and whether or not the request succeeds at all).
 */

interface PhotonProperties {
  name?: string;
  housenumber?: string;
  street?: string;
  city?: string;
  state?: string;
}

/** "Name, 123 Street, City, State" from whichever parts a hit carries. */
function formatPlace(p: PhotonProperties): string {
  const street =
    p.street && p.housenumber ? `${p.housenumber} ${p.street}` : (p.street ?? undefined);
  const parts = [p.name, street, p.city, p.state].filter(
    (x): x is string => typeof x === 'string' && x.length > 0
  );
  return [...new Set(parts)].join(', ');
}

/**
 * Coarse device position to bias suggestions toward nearby places, asked for
 * the FIRST time a search runs (i.e. while typing in the Where field, where
 * the permission prompt has obvious context — never at app launch). One
 * shared promise, so overlapping keystrokes trigger one prompt; the answer —
 * including a denial — is cached for the session and never re-asked. The
 * position rides along as Photon bias params only: not stored, not synced,
 * never sent to our backend. Works identically on web and in the Capacitor
 * WebView (the bridge forwards the prompt to the Android runtime permission).
 */
let biasPromise: Promise<{ lat: number; lon: number } | null> | undefined;

function locationBias(): Promise<{ lat: number; lon: number } | null> {
  biasPromise ??= new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => resolve(null), // denied / unavailable / timed out — unbiased search still works
      // ponytail: coarse + cached-for-10min is all a search bias needs — no GPS spin-up.
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 600_000 }
    );
  });
  return biasPromise;
}

/** Test-only: forget the cached geolocation answer. */
export function resetLocationBiasForTests(): void {
  biasPromise = undefined;
}

/** Up to 5 deduped suggestion labels; [] for short queries or any failure. */
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<string[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const params = new URLSearchParams({ q, limit: '5' });
  const bias = await locationBias();
  if (bias) {
    params.set('lat', String(bias.lat));
    params.set('lon', String(bias.lon));
  }
  const res = await fetch(`https://photon.komoot.io/api/?${params.toString()}`, { signal });
  if (!res.ok) return [];
  const body = (await res.json()) as {
    features?: Array<{ properties?: PhotonProperties }>;
  };
  const labels = (body.features ?? []).map((f) => formatPlace(f.properties ?? {}));
  return [...new Set(labels.filter((s) => s.length > 0))];
}

/**
 * Google Maps search URL for any location text (the keyless Maps URLs API) —
 * a real place opens the pin, a custom label just opens a search for it.
 */
export function mapsSearchUrl(location: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
}
