/**
 * Fetches Scryfall's full set list (~800 sets, small payload) and caches it in memory.
 * Refreshes once per TTL window. Concurrent calls share a single in-flight request.
 */

interface ScryfallSet {
  code: string;
  name: string;
  icon_svg_uri: string;
  released_at?: string;
}

interface ScryfallSetsResponse {
  object: 'list';
  data: ScryfallSet[];
}

export interface SetSummary {
  code: string;
  name: string;
  iconSvgUri: string;
  releasedAt: string;
}

export type SetMap = Record<string, SetSummary>;

const TTL_MS = 24 * 60 * 60 * 1000;
const SCRYFALL_SETS_URL = 'https://api.scryfall.com/sets';

let cached: { at: number; map: SetMap } | null = null;
let inFlight: Promise<SetMap> | null = null;

export async function getSetMap(): Promise<SetMap> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.map;
  if (inFlight) return inFlight;

  inFlight = fetchSetMap()
    .then((map) => {
      cached = { at: Date.now(), map };
      return map;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

async function fetchSetMap(): Promise<SetMap> {
  const response = await fetch(SCRYFALL_SETS_URL, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'spellcontrol/1.0',
    },
  });
  if (!response.ok) {
    throw new Error(`Scryfall /sets returned HTTP ${response.status}`);
  }
  const json = (await response.json()) as ScryfallSetsResponse;
  const map: SetMap = {};
  for (const s of json.data) {
    const code = s.code.toUpperCase();
    map[code] = { code, name: s.name, iconSvgUri: s.icon_svg_uri, releasedAt: s.released_at ?? '' };
  }
  return map;
}
