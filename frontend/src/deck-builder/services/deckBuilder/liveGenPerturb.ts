/**
 * Controlled input perturbations for the live panel's stability run (E1061).
 *
 * A change to the candidate pool has rerouted the late passes on decks it never
 * targeted (E1052, 2026-10-31). To measure that, the panel regenerates the same
 * decks from the same recorded data with ONE thing changed, then diffs the decks
 * (frontend/scripts/gen-stability.mjs). The change lands in the fetch stub of
 * deckGenerator.live.test.ts, on the EDHREC page body, so no generator code is
 * touched. LIVE_GEN_PERTURB takes one of:
 *
 *   none                          identical rerun: the determinism check
 *   add:<Card>@<pct>[@<list>]     one more card on every EDHREC page, `pct` percent
 *                                 inclusion, in list `list` (default utilityartifacts).
 *                                 `floor` seats it at the page's lowest inclusion, so the
 *                                 page floor the objective reads off-page cards at does
 *                                 not move (a lower pct does move it: board E1061)
 *   shuffle:<seed>                the order of the cards inside every EDHREC list
 *   seed:<n>                      the whole-deck search's goldfish seed
 *
 * `shuffle` only reaches the generator through ties: parseCardlists sorts each
 * list by inclusion, and the sort is stable.
 */

export type Perturbation =
  | { kind: 'none' }
  | { kind: 'add'; name: string; pct: number | 'floor'; list: string }
  | { kind: 'shuffle'; seed: number }
  | { kind: 'seed'; seed: number };

export function parsePerturbation(raw: string | undefined): Perturbation {
  const text = (raw ?? '').trim();
  if (!text || text === 'none') return { kind: 'none' };
  const colon = text.indexOf(':');
  const kind = colon < 0 ? text : text.slice(0, colon);
  const rest = colon < 0 ? '' : text.slice(colon + 1);
  if (kind === 'shuffle' || kind === 'seed') {
    const seed = Number(rest);
    if (!Number.isInteger(seed)) throw new Error(`LIVE_GEN_PERTURB ${kind}: needs an integer`);
    return { kind, seed };
  }
  if (kind === 'add') {
    const [name, pct, list] = rest.split('@');
    const n = pct === 'floor' ? 'floor' : Number(pct);
    if (!name || (n !== 'floor' && (!Number.isFinite(n) || n < 0 || n > 100)))
      throw new Error('LIVE_GEN_PERTURB add: wants add:<Card>@<pct 0-100 | floor>[@<list>]');
    return { kind, name, pct: n, list: list || 'utilityartifacts' };
  }
  throw new Error(`LIVE_GEN_PERTURB: unknown perturbation "${text}"`);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(items: T[], rand: () => number): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

interface RawView {
  name: string;
  [k: string]: unknown;
}
interface RawList {
  tag: string;
  header?: string;
  cardviews?: RawView[];
}

/** The page's card lists, or null when the body is not an EDHREC card page. */
function cardlistsOf(json: unknown): RawList[] | null {
  const lists = (json as { container?: { json_dict?: { cardlists?: unknown } } })?.container
    ?.json_dict?.cardlists;
  return Array.isArray(lists) ? (lists as RawList[]) : null;
}

function sanitize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * The body with the perturbation applied. A body that is not an EDHREC card
 * page, or a perturbation that does not touch card lists, comes back as given.
 */
export function perturbEdhrecBody(body: string, p: Perturbation, url: string): string {
  // Commander pages only (base, bracket, budget, theme): the pool the generator picks
  // from. Card pages feed the lift pools, and a card added there is a different change.
  if (!url.includes('/pages/commanders/')) return body;
  if (p.kind === 'none' || p.kind === 'seed' || !body.includes('"cardlists"')) return body;
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return body;
  }
  const lists = cardlistsOf(json);
  if (!lists) return body;
  if (p.kind === 'shuffle') {
    const rand = mulberry32(p.seed);
    for (const list of lists) if (list.cardviews) shuffleInPlace(list.cardviews, rand);
  } else {
    const key = p.name.toLowerCase();
    const present = lists.some((l) => l.cardviews?.some((c) => c.name.toLowerCase() === key));
    if (present) return body;
    let list = lists.find((l) => l.tag === p.list);
    if (!list) {
      list = { tag: p.list, header: p.list, cardviews: [] };
      lists.push(list);
    }
    const views = (list.cardviews ??= []);
    // Same shape as a neighbour, so every field the client reads is present.
    const template = views[0] ?? lists.flatMap((l) => l.cardviews ?? [])[0];
    const potential = Number(template?.potential_decks) || 1000;
    const slug = sanitize(p.name);
    const shares = lists
      .flatMap((l) => l.cardviews ?? [])
      .map((c) => Number(c.num_decks ?? c.inclusion) / (Number(c.potential_decks) || 1))
      .filter((x) => x > 0);
    const pct = p.pct === 'floor' ? Math.min(...shares, 1) * 100 : p.pct;
    views.push({
      ...(template ?? {}),
      id: `perturb-${slug}`,
      name: p.name,
      sanitized: slug,
      slug,
      url: `/cards/${slug}`,
      num_decks: Math.max(1, Math.round((pct / 100) * potential)),
      potential_decks: potential,
    });
  }
  return JSON.stringify(json);
}
