// Pure half of refresh-idea-index.mjs: sorting EDHREC tags into creature types and ways to play,
// the keep/drop gate, and the alias table. No I/O, so it is unit-tested without the network.

/** A tag survives only with at least this many decks... */
export const MIN_DECKS = 500;
/** ...and at least this many commanders on its tag page. */
export const MIN_COMMANDERS = 5;
/** Generic styles that describe every deck, not an idea someone would start from. */
export const DROPPED_SLUGS = new Set(['aggro', 'midrange', 'good-stuff']);

/**
 * Search terms people type that are not the tag's own name. Keyed by tag slug; a slug the snapshot
 * does not carry is skipped at build time, so this list can run ahead of the data.
 */
export const ALIAS_TERMS = {
  aristocrats: ['sac', 'sac outlet', 'sacrifice outlet', 'death triggers'],
  tokens: ['go wide', 'token', 'populate'],
  'plus-1-plus-1-counters': ['+1/+1', 'plus one counters', 'counters', 'p1p1'],
  'lands-matter': ['land', 'lands'],
  landfall: ['land drop', 'landfall'],
  spellslinger: ['spells', 'instants and sorceries', 'storm'],
  lifegain: ['life gain', 'gain life'],
  lifedrain: ['drain'],
  reanimator: ['reanimate', 'recursion', 'graveyard'],
  'extra-turns': ['time walk', 'time travel'],
  blink: ['flicker', 'etb'],
  voltron: ['equipment aura', 'suit up'],
  ramp: ['mana', 'big mana'],
  treasure: ['treasures'],
  'group-hug': ['hug'],
  'group-slug': ['slug', 'pingers'],
  'go-wide': ['wide', 'swarm'],
  'x-spells': ['x spell'],
  'card-draw': ['draw', 'cantrips'],
  flying: ['fliers', 'flyers', 'evasion'],
  'pillow-fort': ['fort', 'propaganda'],
  'big-mana': ['mana rocks'],
  clones: ['copy', 'copies'],
  'self-mill': ['mill myself', 'dredge'],
  'tap-untap': ['untap'],
};

/** Singular candidates for a plural creature-type tag name ("Elves" -> "elf", "Harpies" -> "harpy"). */
export function singularForms(word) {
  const w = word.toLowerCase().trim();
  const out = new Set([w]);
  if (w.endsWith('ves')) {
    out.add(`${w.slice(0, -3)}f`);
    out.add(`${w.slice(0, -3)}fe`);
  }
  if (w.endsWith('ies')) out.add(`${w.slice(0, -3)}y`);
  if (w.endsWith('es')) out.add(w.slice(0, -2));
  if (w.endsWith('s')) out.add(w.slice(0, -1));
  if (w.endsWith('mice')) out.add(`${w.slice(0, -4)}mouse`);
  if (w.endsWith('men')) out.add(`${w.slice(0, -3)}man`);
  if (w.endsWith('i')) out.add(`${w.slice(0, -1)}us`);
  return [...out];
}

/**
 * The singular creature type a plural tag name stands for ("Elves" -> "Elf", "Time Lords" ->
 * "Time Lord"), in Scryfall's spelling, or null for a way to play. The last word is what
 * pluralizes, so try the whole name, then the singulars of its last word.
 */
export function creatureTypeOf(name, creatureTypes) {
  const byLower = new Map(creatureTypes.map((t) => [t.toLowerCase(), t]));
  const lower = name.toLowerCase().trim();
  if (byLower.has(lower)) return byLower.get(lower);
  const words = lower.split(/\s+/);
  const head = words.slice(0, -1).join(' ');
  for (const form of singularForms(words[words.length - 1])) {
    const hit = byLower.get(head ? `${head} ${form}` : form);
    if (hit) return hit;
  }
  return null;
}

export function slugOfUrl(url) {
  return String(url ?? '')
    .replace(/^\/tags\//, '')
    .replace(/\/+$/, '');
}

/**
 * Whether a tag stays. `commanders` is the length of its tag page's Top Commanders list, or null
 * when the page could not be read (never kept: an idea with no commanders has nowhere to go).
 */
export function keepTag({ slug, decks, commanders }) {
  if (!slug || DROPPED_SLUGS.has(slug)) return false;
  if (!(decks >= MIN_DECKS)) return false;
  return commanders !== null && commanders >= MIN_COMMANDERS;
}

/** Aliases for the slugs that survived, with the tag's own name and singular forms left to the client. */
export function aliasesFor(slugs) {
  const have = new Set(slugs);
  const out = {};
  for (const [slug, terms] of Object.entries(ALIAS_TERMS)) if (have.has(slug)) out[slug] = terms;
  return out;
}

/**
 * Turn the raw tag list and the per-tag page facts into the committed file's idea rows.
 * `pages` maps slug -> { commanders: number, top: string | null } (null when unreadable).
 */
export function buildIdeas(tags, pages, creatureTypes) {
  const ideas = [];
  let dropped = 0;
  for (const t of tags) {
    const slug = slugOfUrl(t.url);
    const page = pages.get(slug) ?? null;
    if (!keepTag({ slug, decks: t.num_decks, commanders: page ? page.commanders : null })) {
      dropped++;
      continue;
    }
    const type = creatureTypeOf(t.name, creatureTypes);
    ideas.push({
      slug,
      name: t.name,
      kind: type ? 'typal' : 'playstyle',
      // The singular type a typal idea counts in a collection's type lines.
      ...(type ? { type } : {}),
      decks: t.num_decks,
      commanders: page.commanders,
      card: page.top ?? t.sanitized ?? '',
    });
  }
  ideas.sort((a, b) => b.decks - a.decks || a.name.localeCompare(b.name));
  return { ideas, dropped };
}
