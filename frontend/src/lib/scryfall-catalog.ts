/**
 * Fetches Scryfall catalog data for autocomplete suggestions.
 * Each catalog is fetched at most once per session (in-memory cache).
 * Callers get a flat, sorted, deduplicated string array.
 */

const cache = new Map<string, string[]>();

async function fetchCatalog(name: string): Promise<string[]> {
  if (cache.has(name)) return cache.get(name)!;
  try {
    const res = await fetch(`https://api.scryfall.com/catalog/${name}`);
    if (!res.ok) return [];
    const json = await res.json();
    const data: string[] = json.data ?? [];
    cache.set(name, data);
    return data;
  } catch {
    return [];
  }
}

/** Type-line tokens: supertypes + card types + all subtype catalogs. */
export async function fetchTypeSuggestions(): Promise<string[]> {
  const results = await Promise.all([
    fetchCatalog('supertypes'),
    fetchCatalog('card-types'),
    fetchCatalog('creature-types'),
    fetchCatalog('planeswalker-types'),
    fetchCatalog('land-types'),
    fetchCatalog('artifact-types'),
    fetchCatalog('enchantment-types'),
    fetchCatalog('spell-types'),
  ]);
  const all = results.flat();
  return [...new Set(all)].sort((a, b) => a.localeCompare(b));
}

/**
 * Common oracle text phrases that aren't formal keywords and therefore won't
 * appear in any Scryfall catalog. These are the terms players actually search
 * for when building binder rules.
 */
const COMMON_ORACLE_PHRASES: string[] = [
  // Card draw
  'draw a card',
  'draw two cards',
  'draw three cards',
  'draw cards',
  // Removal
  'destroy target',
  'destroy target creature',
  'destroy all',
  'destroy all creatures',
  'exile target',
  'exile target creature',
  'exile all',
  'counter target spell',
  'counter target',
  // Damage
  'deal damage',
  'deals damage',
  'deals combat damage',
  // Life
  'gain life',
  'lose life',
  'pay life',
  'you gain',
  'you lose',
  // Tokens
  'create a token',
  'create a 1/1',
  'create a 2/2',
  'create a 3/3',
  'create a 4/4',
  // Counters
  'put a +1/+1 counter',
  'put a -1/-1 counter',
  'put a counter',
  'add a +1/+1 counter',
  'remove a counter',
  // ETB / LTB
  'enters the battlefield',
  'enters tapped',
  'leaves the battlefield',
  'when ~ dies',
  'dies',
  'when ~ enters',
  // Mana
  'add {',
  'add mana',
  'add one mana',
  'untap target',
  // Search
  'search your library',
  'tutor',
  // Targeting
  'target player',
  'target opponent',
  'each player',
  'each opponent',
  // Discard / sacrifice
  'discard',
  'discard a card',
  'sacrifice',
  'sacrifice a creature',
  // Copying
  'copy',
  'copies of',
  'copy target',
  // Bounce / return
  'return to its owner',
  'return target',
  'return to hand',
  // Triggers
  'whenever',
  'at the beginning',
  'at the end of each turn',
  'at the beginning of your upkeep',
  'at the beginning of your end step',
];

/** Oracle text suggestions: Scryfall keyword catalogs + common phrases. */
export async function fetchOracleSuggestions(): Promise<string[]> {
  const results = await Promise.all([
    fetchCatalog('keyword-abilities'),
    fetchCatalog('keyword-actions'),
    fetchCatalog('ability-words'),
  ]);
  const all = [...results.flat(), ...COMMON_ORACLE_PHRASES];
  return [...new Set(all)].sort((a, b) => a.localeCompare(b));
}
