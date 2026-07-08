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

/** Up to 5 deduped suggestion labels; [] for short queries or any failure. */
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<string[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5`, {
    signal,
  });
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
