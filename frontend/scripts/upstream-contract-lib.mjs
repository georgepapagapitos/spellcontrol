// Pure contract checks for the nightly upstream check (upstream-contract.mjs).
// Each check takes one fetched JSON body and returns a list of failure strings
// (empty = the contract holds) plus, where useful, a note on what was seen.
// No I/O here, so every check is unit-tested against real response fixtures,
// including the shapes that silently broke a feature before:
//   - EDHREC 2026-07: cardview `inclusion` -> `num_decks`
//   - EDHREC 2026-07 (E126): `salt` / `prices` / `type_line` dropped from
//     cardviews; salt moved from a `label` string to a numeric `salt` field
//   - EDHREC 2026-10: the `highsynergycards` list renamed `highliftcards`
//   - Scryfall bulk index: `download_uri` -> `jsonl_download_uri`
// Each reader named below is the code whose reads these assertions mirror.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Share of `items` passing `pred`, 0 for an empty list. */
const share = (items, pred) => (items.length ? items.filter(pred).length / items.length : 0);
const pct = (x) => `${Math.round(x * 100)}%`;

/** Share of cardviews that must carry a field before the contract holds. */
export const MIN_FIELD_SHARE = 0.9;

/** Type-list tags frontend/src/deck-builder/services/edhrec/client.ts maps to a
 *  card type (TAG_TYPE_MAP). A page may lack a few (a commander can have no
 *  planeswalkers); the core ones must be there. */
export const TYPE_LIST_TAGS = [
  'creatures',
  'instants',
  'sorceries',
  'utilityartifacts',
  'manaartifacts',
  'enchantments',
  'planeswalkers',
  'utilitylands',
  'lands',
];
export const CORE_TYPE_LIST_TAGS = ['creatures', 'instants', 'sorceries', 'enchantments', 'lands'];

/** EDHREC ships the archetype-defining list under one of these. */
export const THEME_LIST_TAGS = ['highliftcards', 'highsynergycards'];

/** Lists that hold commanders, not cards (tag pages). */
const COMMANDER_LIST_TAGS = new Set(['newcommanders', 'topcommanders']);

function cardlistsOf(body) {
  return body?.container?.json_dict?.cardlists;
}

/** Per-cardview checks shared by every EDHREC card list: a name, a deck count
 *  (`num_decks`, or `inclusion` before 2026-07), `potential_decks`, and (for
 *  card lists) `synergy` or `lift`. Returns failures. */
function cardviewFailures(listTag, views, { wantSynergy }) {
  const out = [];
  if (!views.length) return [`${listTag}: no cardviews`];
  const named = share(views, (v) => isStr(v?.name));
  if (named < 1) out.push(`${listTag}: ${pct(1 - named)} of cardviews have no name`);
  const counted = share(views, (v) => isNum(v?.num_decks) || isNum(v?.inclusion));
  if (counted < MIN_FIELD_SHARE) {
    out.push(
      `${listTag}: only ${pct(counted)} of cardviews carry num_decks or inclusion (need ${pct(MIN_FIELD_SHARE)})`
    );
  }
  const potential = share(views, (v) => isNum(v?.potential_decks) && v.potential_decks > 0);
  if (potential < MIN_FIELD_SHARE) {
    out.push(
      `${listTag}: only ${pct(potential)} of cardviews carry potential_decks > 0 (need ${pct(MIN_FIELD_SHARE)})`
    );
  }
  if (wantSynergy) {
    const syn = share(views, (v) => isNum(v?.synergy) || isNum(v?.lift));
    if (syn < MIN_FIELD_SHARE) {
      out.push(
        `${listTag}: only ${pct(syn)} of cardviews carry synergy or lift (need ${pct(MIN_FIELD_SHARE)})`
      );
    }
  }
  return out;
}

/** Checks every card-bearing list of a commander or tag page. */
function cardListsFailures(lists, { requireTypeLists }) {
  const out = [];
  const tags = new Set(lists.map((l) => l?.tag));
  if (requireTypeLists) {
    const missingCore = CORE_TYPE_LIST_TAGS.filter((t) => !tags.has(t));
    if (missingCore.length) out.push(`type lists missing: ${missingCore.join(', ')}`);
    const present = TYPE_LIST_TAGS.filter((t) => tags.has(t)).length;
    if (present < 7) out.push(`only ${present} of ${TYPE_LIST_TAGS.length} type-list tags present`);
  }
  for (const l of lists) {
    if (!Array.isArray(l?.cardviews)) {
      out.push(`${l?.tag}: cardviews is not an array`);
      continue;
    }
    const isCmdrList = COMMANDER_LIST_TAGS.has(l.tag);
    out.push(...cardviewFailures(l.tag, l.cardviews, { wantSynergy: !isCmdrList }));
  }
  return out;
}

/** Which theme list a page ships, or null. Needs at least one card in it. */
export function themeListOf(lists) {
  for (const tag of THEME_LIST_TAGS) {
    const l = lists.find((x) => x?.tag === tag);
    if (l && Array.isArray(l.cardviews) && l.cardviews.length > 0) return tag;
  }
  return null;
}

/**
 * /pages/commanders/<slug>.json — frontend edhrec/client.ts parseEdhrecResponse.
 * @returns {{failures: string[], notes: string[]}}
 */
export function checkEdhrecCommanderPage(body) {
  const failures = [];
  const notes = [];
  const lists = cardlistsOf(body);
  if (!Array.isArray(lists) || !lists.length) {
    return { failures: ['container.json_dict.cardlists is missing or empty'], notes };
  }
  failures.push(...cardListsFailures(lists, { requireTypeLists: true }));
  const theme = themeListOf(lists);
  if (!theme) {
    failures.push(`no theme list: neither ${THEME_LIST_TAGS.join(' nor ')} has any cards`);
  } else {
    notes.push(`theme list is "${theme}"`);
  }
  const cmdr = body.container.json_dict.card;
  if (!isNum(cmdr?.num_decks) || cmdr.num_decks <= 0) {
    failures.push('container.json_dict.card.num_decks (the commander deck count) is missing');
  }
  const links = body.panels?.taglinks;
  if (
    !Array.isArray(links) ||
    !links.length ||
    !links.every((t) => isStr(t?.value) && isStr(t?.slug) && isNum(t?.count))
  ) {
    failures.push('panels.taglinks (the themes) is missing or lost value/slug/count');
  }
  return { failures, notes };
}

/** /pages/tags/<slug>.json — client.ts fetchTagPageData. */
export function checkEdhrecTagPage(body) {
  const failures = [];
  const notes = [];
  const lists = cardlistsOf(body);
  if (!Array.isArray(lists) || !lists.length) {
    return { failures: ['container.json_dict.cardlists is missing or empty'], notes };
  }
  if (!lists.some((l) => l?.tag === 'topcommanders' && l.cardviews?.length)) {
    failures.push('no topcommanders list (fetchTagPageData reads it)');
  }
  failures.push(...cardListsFailures(lists, { requireTypeLists: true }));
  const theme = themeListOf(lists);
  if (!theme) failures.push(`no theme list: neither ${THEME_LIST_TAGS.join(' nor ')}`);
  else notes.push(`theme list is "${theme}"`);
  return { failures, notes };
}

/**
 * /pages/top/salt.json — client.ts fetchSaltIndex / parseSaltIndex, and
 * backend edhrec/top-lists.ts kind=salt. Salt must be a numeric field: the
 * legacy `label: "Salt Score: 3.05"` string is not the contract any more.
 */
export function checkEdhrecSalt(body) {
  const lists = cardlistsOf(body);
  const views = lists?.[0]?.cardviews;
  if (!Array.isArray(views) || !views.length) {
    return { failures: ['cardlists[0].cardviews is missing or empty'], notes: [] };
  }
  const failures = [];
  if (views.length < 50) failures.push(`only ${views.length} salty cards (expected ~100)`);
  const numeric = share(views, (v) => isNum(v?.salt) && v.salt > 0);
  if (numeric < MIN_FIELD_SHARE) {
    failures.push(
      `only ${pct(numeric)} of cardviews carry a numeric salt > 0 (need ${pct(MIN_FIELD_SHARE)})`
    );
  }
  if (share(views, (v) => isStr(v?.name)) < 1) failures.push('a cardview has no name');
  return { failures, notes: [`${views.length} salty cards`] };
}

/** /pages/combos/<slug>.json — client.ts fetchCommanderCombosRaw. */
export function checkEdhrecCombos(body) {
  const lists = cardlistsOf(body);
  if (!Array.isArray(lists) || lists.length < 5) {
    return {
      failures: [`cardlists has ${Array.isArray(lists) ? lists.length : 'no'} combos (need 5+)`],
      notes: [],
    };
  }
  const failures = [];
  const ok = (e) =>
    isStr(e?.combo?.comboId) &&
    isNum(e.combo.count) &&
    Array.isArray(e.combo.results) &&
    isNum(e.combo.nonCardPrerequisiteCount) &&
    isNum(e.combo.rank) &&
    Array.isArray(e.cardviews) &&
    e.cardviews.length >= 2 &&
    e.cardviews.every((c) => isStr(c?.name) && isStr(c?.id)) &&
    isStr(e.href);
  const good = share(lists, ok);
  if (good < MIN_FIELD_SHARE) {
    failures.push(
      `only ${pct(good)} of combos carry comboId, count, results, nonCardPrerequisiteCount, rank, href and 2+ named cardviews`
    );
  }
  return { failures, notes: [`${lists.length} combos`] };
}

/**
 * The top lists backend/src/edhrec/top-lists.ts parseTopList reads:
 * /pages/top/<period>.json (cards) and /pages/commanders/<period>.json.
 */
export function checkEdhrecTopList(body, kind) {
  const lists = cardlistsOf(body);
  const views = lists?.[0]?.cardviews;
  if (!Array.isArray(views) || !views.length) {
    return { failures: ['cardlists[0].cardviews is missing or empty'], notes: [] };
  }
  const failures = [];
  if (views.length < 10) failures.push(`only ${views.length} entries`);
  if (share(views, (v) => isStr(v?.name)) < 1) failures.push('an entry has no name');
  const counted = share(views, (v) => isNum(v?.num_decks) || isNum(v?.inclusion));
  if (counted < MIN_FIELD_SHARE) {
    failures.push(`only ${pct(counted)} of entries carry num_decks or inclusion`);
  }
  const ids = share(views, (v) => typeof v?.id === 'string' && UUID_RE.test(v.id));
  if (ids < MIN_FIELD_SHARE) {
    failures.push(`only ${pct(ids)} of entries carry a Scryfall id (the top list stores it)`);
  }
  return { failures, notes: [`${kind}: ${views.length} entries`] };
}

/** GET /cards/named — the fields backend scryfall.ts / types.ts ScryfallCard read. */
export function checkScryfallCard(card) {
  if (!isObj(card)) return { failures: ['response is not an object'], notes: [] };
  const failures = [];
  for (const f of ['id', 'oracle_id', 'name', 'set', 'set_name', 'collector_number', 'rarity']) {
    if (!isStr(card[f])) failures.push(`${f} is missing`);
  }
  if (!isNum(card.cmc)) failures.push('cmc is missing');
  if (!isStr(card.type_line)) failures.push('type_line is missing');
  if (!Array.isArray(card.color_identity)) failures.push('color_identity is missing');
  if (!isObj(card.legalities) || !isStr(card.legalities.commander)) {
    failures.push('legalities.commander is missing');
  }
  if (!isObj(card.prices) || !('usd' in card.prices)) failures.push('prices.usd key is missing');
  if (!Array.isArray(card.finishes)) failures.push('finishes is missing');
  if (!isObj(card.image_uris) || !isStr(card.image_uris.normal)) {
    failures.push('image_uris.normal is missing');
  }
  return { failures, notes: [] };
}

/** Bulk types the backend ingests (scryfall-bulk.ts) and the snapshot scripts read. */
export const BULK_TYPES = ['default_cards', 'oracle_cards', 'oracle_tags'];

/** GET /bulk-data — scryfall-bulk.ts fetchScryfallBulkEntry. */
export function checkScryfallBulkIndex(body) {
  if (!Array.isArray(body?.data)) return { failures: ['data is not an array'], notes: [] };
  const failures = [];
  const notes = [];
  for (const type of BULK_TYPES) {
    const e = body.data.find((x) => x?.type === type);
    if (!e) {
      failures.push(`no "${type}" entry`);
      continue;
    }
    const uri = e.jsonl_download_uri ?? e.download_uri;
    if (!isStr(uri) || !/^https:\/\//.test(uri)) failures.push(`${type}: no download uri`);
    else notes.push(`${type} via ${e.jsonl_download_uri ? 'jsonl_download_uri' : 'download_uri'}`);
    if (!isStr(e.updated_at) || Number.isNaN(Date.parse(e.updated_at))) {
      failures.push(`${type}: updated_at is missing`);
    }
  }
  return { failures, notes };
}

/** One oracle_tags JSONL record — refresh-otag-index.mjs build(). */
export function checkOtagRecord(rec) {
  if (!isObj(rec)) return { failures: ['record is not an object'], notes: [] };
  const failures = [];
  if (!isStr(rec.id)) failures.push('id is missing');
  if (!Array.isArray(rec.taggings)) failures.push('taggings is not an array');
  else if (rec.taggings.length && !isStr(rec.taggings[0]?.oracle_id)) {
    failures.push('taggings[].oracle_id is missing');
  }
  if (rec.parent_ids !== undefined && !Array.isArray(rec.parent_ids)) {
    failures.push('parent_ids is not an array');
  }
  return { failures, notes: [] };
}

/** The oracle_cards join side of refresh-otag-index.mjs: oracle_id and name. */
export function checkOracleCardRecord(rec) {
  const failures = [];
  if (!isStr(rec?.oracle_id)) failures.push('oracle_id is missing');
  if (!isStr(rec?.name)) failures.push('name is missing');
  return { failures, notes: [] };
}

/** otag queries refresh-tagger.mjs TAG_QUERIES maps, with a floor on matches. A
 *  renamed upstream tag matches 0 (mana-fix did on 2026-09-01). */
export const OTAG_QUERIES = [
  { query: 'otag:ramp', min: 500 },
  { query: 'otag:removal', min: 1000 },
  { query: 'otag:boardwipe', min: 200 },
  { query: 'otag:draw', min: 1000 },
  { query: 'otag:tutor', min: 300 },
  { query: 'otag:counterspell', min: 150 },
  { query: 'otag:sacrifice-outlet', min: 300 },
  { query: 'otag:chromatic-lantern', min: 20 },
];

/** GET /cards/search?q=otag:… — the list envelope fetchTagCount reads. */
export function checkOtagSearch(body, min) {
  if (body?.object !== 'list') {
    return { failures: [`object is "${body?.object}", not a list`], notes: [] };
  }
  const n = body.total_cards;
  if (!isNum(n)) return { failures: ['total_cards is missing'], notes: [] };
  const failures = n < min ? [`matched ${n} cards, expected at least ${min}`] : [];
  return { failures, notes: [`${n} cards`] };
}

/** Variants from Commander Spellbook's variants.json — backend combos/ingest.ts parseVariant. */
export function checkSpellbookVariants(variants) {
  if (!Array.isArray(variants) || !variants.length) {
    return { failures: ['no variants parsed'], notes: [] };
  }
  const failures = [];
  const usable = (v) =>
    isStr(v?.id) &&
    Array.isArray(v.uses) &&
    v.uses.length > 0 &&
    v.uses.every((u) => isStr(u?.card?.oracleId) && isStr(u.card.name));
  if (share(variants, usable) < 1)
    failures.push('a variant lost id or uses[].card.{oracleId,name}');
  if (share(variants, (v) => typeof v?.bracketTag === 'string') < 1) {
    failures.push('bracketTag is missing on a variant');
  }
  if (
    share(
      variants,
      (v) => Array.isArray(v?.produces) && v.produces.every((p) => isStr(p?.feature?.name))
    ) < 1
  ) {
    failures.push('produces[].feature.name is missing');
  }
  if (share(variants, (v) => typeof v?.identity === 'string') < 1)
    failures.push('identity is missing');
  if (share(variants, (v) => isObj(v?.legalities)) < 1) failures.push('legalities is missing');
  if (share(variants, (v) => isNum(v?.popularity) || v?.popularity === null) < 1) {
    failures.push('popularity is not a number');
  }
  return { failures, notes: [`${variants.length} variants`] };
}

/**
 * Pulls the first `n` complete variant objects out of a PREFIX of
 * variants.json (`{"timestamp":…,"variants":[{…},{…}…`), so the check never
 * downloads the ~100 MB file. Returns [] when no object completes in `text`.
 */
export function firstVariants(text, n) {
  const key = text.indexOf('"variants"');
  const start = key < 0 ? -1 : text.indexOf('[', key);
  if (start < 0) return [];
  const out = [];
  let depth = 0;
  let inStr = false;
  let esc = false;
  let objStart = -1;
  for (let i = start + 1; i < text.length && out.length < n; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') {
      if (depth === 0) objStart = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) out.push(JSON.parse(text.slice(objStart, i + 1)));
    }
  }
  return out;
}
