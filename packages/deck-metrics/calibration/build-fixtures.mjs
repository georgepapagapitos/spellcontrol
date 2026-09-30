// Builds calibration/fixtures/corpus.json, the frozen input of the bracket
// calibration benchmark (src/calibration). Run by hand when a source changes;
// CI only reads the output, so the benchmark needs no network.
//
//   npm run build            # the benchmark reads nothing from dist, but this script does
//   node calibration/build-fixtures.mjs --sources <dir> [--fetch-missing]
//
// <dir> holds the raw sources (none of them is committed here):
//   precons.json       MTGJSON Commander precons, trimmed: [{fileName, name, code,
//                      releaseDate, commander[], mainBoard[{name, mv, types, count,
//                      text, layout}]}]. MTGJSON DeckList.json filtered to
//                      type === 'Commander Deck', then decks/<fileName>.json (GETs).
//   spellbook.json     Commander Spellbook /estimate-bracket answers per precon
//                      fileName ({bracketTag, cards[], combos[]}), from the one-off
//                      run of 2026-09-23 the user approved. Never re-POST decklists
//                      without asking: it is not ours to load.
//   scrollvault.json   ScrollVault precon library pages
//                      (scrollvault.net/tools/commander-bracket/precons/*.html,
//                      robots.txt allows them), one entry per page: {url, fileName,
//                      bracket, power, gc, why[], analyzed}.
//   edhtop16.json      EDHTop16 (robots.txt: allow all) GraphQL `tournament.entries
//                      (maxStanding: 8)` for the largest cEDH events of the last
//                      three months: {tournament, standing, decklist, commander,
//                      maindeck[{name, type, cmc}]}.
//   combos.json        The Commander Spellbook dataset as the app ingests it, from
//                      the dev Postgres (read-only):
//                        select json_agg(x) from (select c.id, c.bracket_tag t,
//                        c.card_count n, (c.legalities->>'commander') l,
//                        c.template_queries q, (select json_agg(cc.card_name order
//                        by cc.position) from combo_cards cc where cc.combo_id=c.id)
//                        cards from combos c) x
//   gamechangers.json  Scryfall `is:gamechanger` search (the official list as
//                      Scryfall carries it), page 1 of /cards/search.
//   scryfall-cards.json.gz  {name: {type_line, oracle_text, cmc, mana_cost}} for
//                      names MTGJSON and EDHTop16 don't carry text for.
// plus, from this checkout: frontend/public/tagger-tags.json (the bracket tags)
// and frontend/public/otag-index.json (template `otag:` clauses).
//
// --declared <file> adds owner-declared decks (set 'declared', same shape as
// precons.json plus declaredBracket and url) and --out <file> writes elsewhere.
// Those decks are other people's lists: build them into a local corpus for
// investigation, never into the committed fixture.
//
// --fetch-missing looks up names no source above covers via Scryfall
// /cards/collection (75 per request, 600 ms apart) and caches them in
// <dir>/scryfall-extra.json. Run it through the machine's live-data lock.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const dm = require(path.join(HERE, '../dist/cjs/index.js'));

const args = process.argv.slice(2);
const SRC = args[args.indexOf('--sources') + 1];
if (!SRC || args.indexOf('--sources') < 0) throw new Error('--sources <dir> is required');
const read = (f) => JSON.parse(fs.readFileSync(path.join(SRC, f), 'utf8'));

const precons = read('precons.json');
const spellbook = read('spellbook.json');
const scrollvault = Object.values(read('scrollvault.json'));
const edhtop16 = read('edhtop16.json');
const combosRaw = read('combos.json').filter((c) => c.l === 'legal' && (c.cards?.length ?? 0) > 0);
const gcLive = read('gamechangers.json');
const scryfallCache = JSON.parse(
  zlib.gunzipSync(fs.readFileSync(path.join(SRC, 'scryfall-cards.json.gz'))).toString('utf8')
);
const extraPath = path.join(SRC, 'scryfall-extra.json');
const scryfallExtra = fs.existsSync(extraPath)
  ? JSON.parse(fs.readFileSync(extraPath, 'utf8'))
  : {};
const synthetic = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures/synthetic.json'), 'utf8'));
const taggerFile = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'frontend/public/tagger-tags.json'), 'utf8')
);
const otagFile = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'frontend/public/otag-index.json'), 'utf8')
);

const tags = dm.createTagLookup(taggerFile.tags);
const otagIndex = new Map(otagFile.tags.map((t, i) => [t.s, i]));
const otagCards = new Map(Object.entries(otagFile.cards).map(([n, ids]) => [n, new Set(ids)]));
const oracleTags = {
  isKnownTag: (t) => otagIndex.has(t),
  hasTag: (name, t) => otagCards.get(name)?.has(otagIndex.get(t)) ?? false,
};

// ── Decks ────────────────────────────────────────────────────────────────

const BASICS = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes']);
const SB_TAG_BRACKET = { E: 2, C: 2, O: 3, P: 3, S: 3, R: 4 };
const liveGc = new Set(gcLive.data.map((c) => c.name));
const sbDeck = (fileName) => spellbook[fileName];
const svByFile = new Map(scrollvault.map((s) => [s.fileName, s]));

/** MTGJSON card info, keyed by name, first seen wins (printings share text). */
const mtgjson = new Map();
for (const d of precons) {
  for (const c of [...d.commander, ...d.mainBoard])
    if (!mtgjson.has(c.name)) mtgjson.set(c.name, c);
}
const edhtop = new Map();
for (const e of edhtop16)
  for (const c of e.maindeck ?? []) if (!edhtop.has(c.name)) edhtop.set(c.name, c);

const merge = (cards) => {
  const out = {};
  for (const [name, n] of cards) out[name] = (out[name] ?? 0) + n;
  return out;
};

function preconLabel(d) {
  const sb = sbDeck(d.fileName);
  const names = new Set([...d.commander, ...d.mainBoard].map((c) => c.name));
  const gc = [...names].filter((n) => liveGc.has(n)).length;
  const gcFloor = gc >= 4 ? 4 : gc > 0 ? 3 : 2;
  const sbBracket = sb ? SB_TAG_BRACKET[sb.bracketTag] : undefined;
  const label = Math.max(2, gcFloor, sbBracket ?? 2);
  const why = [];
  if (gc > 0) why.push(`${gc} Game Changer${gc === 1 ? '' : 's'} on the official list`);
  if (sb) why.push(`Commander Spellbook rates the list ${sb.bracketTag}`);
  if (sb?.bracketTag === 'B')
    why.push('B means a banned card; the label rests on the Game Changer count');
  return { label, labelSource: why.join('; ') || 'Core baseline' };
}

/** What Spellbook's answer rests on: its flagged cards and the combos it counts. */
function spellbookSummary(sb) {
  const flagged = (k) =>
    sb.cards
      .filter((c) => c[k])
      .map((c) => c.name)
      .sort();
  return {
    tag: sb.bracketTag,
    gameChangers: flagged('gc'),
    landDenial: flagged('mld'),
    extraTurns: flagged('et'),
    banned: flagged('banned'),
    combos: sb.combos
      .filter((c) => c.relevant)
      .map((c) => `${c.tag}:${c.cards.join(' + ')}`)
      .sort(),
  };
}

const decks = [];
for (const d of precons) {
  const l = preconLabel(d);
  const sv = svByFile.get(d.fileName);
  decks.push({
    id: d.fileName,
    set: 'precon',
    name: `${d.name} (${d.code} ${d.releaseDate.slice(0, 4)})`,
    url: `https://mtgjson.com/api/v5/decks/${d.fileName}.json`,
    commanders: d.commander.map((c) => c.name),
    cards: merge(d.mainBoard.map((c) => [c.name, c.count])),
    label: l.label,
    labelSource: l.labelSource,
    ...(sbDeck(d.fileName) ? { spellbook: spellbookSummary(sbDeck(d.fileName)) } : {}),
    ...(sv ? { scrollvault: { bracket: sv.bracket, url: sv.url, why: sv.why } } : {}),
  });
}

const seenLists = new Set();
for (const e of edhtop16) {
  const main = (e.maindeck ?? []).map((c) => c.name);
  const key = [...main].sort().join('|');
  if (seenLists.has(key)) continue; // one player's list entered twice
  seenLists.add(key);
  decks.push({
    id: `edhtop16:${e.decklist.split('/').slice(-2).join('/')}`,
    set: 'cedh',
    name: `${e.commander.name} (#${e.standing}, ${e.tournament.name})`,
    url: e.decklist,
    commanders: e.commander.name.split(' / '),
    cards: merge(main.map((n) => [n, 1])),
    label: 5,
    labelSource: `Top ${e.standing} of ${e.tournament.size} at ${e.tournament.name} (${e.tournament.tournamentDate.slice(0, 10)}), via EDHTop16`,
  });
}

const declaredAt = args.indexOf('--declared');
if (declaredAt >= 0) {
  const file = args[declaredAt + 1];
  const raw = fs.readFileSync(file);
  const list = JSON.parse((file.endsWith('.gz') ? zlib.gunzipSync(raw) : raw).toString('utf8'));
  for (const d of list) {
    decks.push({
      id: d.fileName,
      set: 'declared',
      name: d.name,
      url: d.url,
      commanders: d.commander.map((c) => c.name),
      cards: merge(d.mainBoard.map((c) => [c.name, c.count])),
      label: d.declaredBracket,
      labelSource: 'owner-declared bracket',
    });
    for (const c of [...d.commander, ...d.mainBoard])
      if (!edhtop.has(c.name)) edhtop.set(c.name, { cmc: c.mv, type: c.types.join(' ') });
  }
}

const base = precons.find((d) => d.fileName === synthetic.base);
for (const c of synthetic.cases) {
  const cards = merge(base.mainBoard.map((x) => [x.name, x.count]));
  for (const add of c.add) {
    const basic = Object.keys(cards).find((n) => BASICS.has(n) && cards[n] > 0);
    cards[basic] -= 1;
    cards[add] = (cards[add] ?? 0) + 1;
  }
  decks.push({
    id: `synthetic:${c.id}`,
    set: 'synthetic',
    name: c.id,
    url: synthetic.sources[c.source],
    commanders: c.commanders ?? base.commander.map((x) => x.name),
    cards,
    label: c.expected,
    labelSource: `${c.authority}: ${c.rule}`,
  });
}

// ── Card facts: mana value, land, counted role ──────────────────────────

const allNames = new Set(synthetic.probes);
for (const d of decks) for (const n of [...d.commanders, ...Object.keys(d.cards)]) allNames.add(n);

function cardInfo(name) {
  const m = mtgjson.get(name);
  if (m) return { mv: m.mv ?? 0, typeLine: m.type ?? m.types.join(' '), text: m.text ?? '' };
  const s = scryfallCache[name] ?? scryfallExtra[name];
  if (s) {
    const face = s.card_faces?.[0];
    return {
      mv: s.cmc ?? 0,
      typeLine: face?.type_line ?? s.type_line ?? '',
      text: face ? (face.oracle_text ?? '') : (s.oracle_text ?? ''),
      raw: s,
    };
  }
  const e = edhtop.get(name);
  if (e) return { mv: e.cmc ?? 0, typeLine: e.type ?? '', text: null };
  return null;
}

async function fetchMissing(names) {
  const missing = [...names].filter((n) => cardInfo(n)?.text == null);
  if (!missing.length || !args.includes('--fetch-missing')) return missing.length;
  for (let i = 0; i < missing.length; i += 75) {
    const batch = missing.slice(i, i + 75);
    const r = await fetch('https://api.scryfall.com/cards/collection', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': 'SpellControl-calibration/1.0',
      },
      body: JSON.stringify({ identifiers: batch.map((name) => ({ name: name.split(' // ')[0] })) }),
    });
    if (!r.ok) throw new Error(`Scryfall ${r.status}`);
    const j = await r.json();
    for (const c of j.data) {
      const want = batch.find(
        (n) => n === c.name || n.split(' // ')[0] === c.name.split(' // ')[0]
      );
      if (want) scryfallExtra[want] = c;
    }
    await new Promise((s) => setTimeout(s, 600));
  }
  fs.writeFileSync(extraPath, JSON.stringify(scryfallExtra));
  return missing.length;
}

const fetchedEarly = await fetchMissing(allNames);

// ── Combos: complete and one card away, per deck ────────────────────────

const byCard = new Map();
for (const c of combosRaw)
  for (const n of new Set(c.cards)) (byCard.get(n) ?? byCard.set(n, []).get(n)).push(c);

const usedCombos = new Map();
const templateCard = (name) => {
  const info = cardInfo(name);
  const raw = info?.raw;
  return {
    name,
    type_line: raw?.type_line ?? info?.typeLine,
    oracle_text: raw?.oracle_text ?? info?.text ?? undefined,
    mana_cost: raw?.mana_cost,
    cmc: raw?.cmc ?? info?.mv,
    colors: raw?.colors,
    keywords: raw?.keywords,
    power: raw?.power,
    toughness: raw?.toughness,
    layout: raw?.layout,
    card_faces: raw?.card_faces,
  };
};

for (const d of decks) {
  const inDeck = new Set([...d.commanders, ...Object.keys(d.cards)]);
  const seen = new Map();
  for (const n of inDeck) for (const c of byCard.get(n) ?? []) seen.set(c.id, c);
  const complete = [];
  const oneAway = [];
  const templates = [];
  const deckCards = [...inDeck].map(templateCard);
  for (const c of seen.values()) {
    const miss = c.cards.filter((n) => !inDeck.has(n));
    if (miss.length > 1) continue;
    usedCombos.set(c.id, c);
    if (miss.length === 1) {
      oneAway.push(c.id);
      continue;
    }
    complete.push(c.id);
    if (c.id.includes('--')) {
      const r = dm.resolveComboTemplates(c.q, c.cards, deckCards, oracleTags);
      if (r.satisfied) templates.push(c.id);
    }
  }
  d.combos = complete.sort();
  d.oneAway = oneAway.sort();
  d.templatesSatisfied = templates.sort();
}

// One-away pieces are what a single swap can bring in, so the stability scan
// needs their facts too.
for (const d of decks)
  for (const id of d.oneAway) for (const n of usedCombos.get(id).cards) allNames.add(n);
const fetchedLate = await fetchMissing(allNames);

// The frontend's counted role (commanderDeckAnalysis.countedRoleOf): none for a
// land (front face), else the first of the card's tagged roles its own text
// backs up. Without text the primary tagged role stands.
function countedRole(name, info) {
  if (/\bland\b/i.test(info.typeLine.split(' // ')[0])) return null;
  const has = (t) => tags.hasTag(name, t);
  const roles = [];
  if (has('boardwipe')) roles.push('boardwipe');
  if (has('removal')) roles.push('removal');
  if (dm.isRampByTags(has)) roles.push('ramp');
  if (['card-advantage', 'tutor', 'draw', 'wheel', 'looting', 'cantrip'].some(has)) {
    roles.push('cardDraw');
  }
  if (info.text == null) return roles[0] ?? null;
  return roles.find((r) => dm.checkRoleEvidence(r, info.text)) ?? null;
}

const cards = {};
const unknown = [];
for (const n of [...allNames].sort()) {
  const info = cardInfo(n);
  if (!info) {
    unknown.push(n);
    continue;
  }
  const land = /\bland\b/i.test(info.typeLine.split(' // ')[0]) ? 1 : 0;
  cards[n] = [info.mv, land, countedRole(n, info)];
}

const combos = {};
for (const [id, c] of [...usedCombos].sort(([a], [b]) => a.localeCompare(b))) {
  combos[id] = [c.t ?? null, c.n, c.cards];
}

// Only the tag memberships the corpus can reach.
const tagSubset = {};
for (const [t, names] of Object.entries(taggerFile.tags)) {
  tagSubset[t] = names.filter((n) => allNames.has(n)).sort();
}

const corpus = {
  meta: {
    built: new Date().toISOString().slice(0, 10),
    taggerSnapshot: taggerFile.generatedAt,
    gameChangers: {
      source: 'Scryfall is:gamechanger (the official Commander Brackets list)',
      fetched: gcLive.fetched ?? null,
      names: [...liveGc].sort(),
    },
    precons: 'MTGJSON Commander Deck lists (https://mtgjson.com/api/v5/DeckList.json)',
    preconLabel:
      'max(2, Game Changer floor on the official list (1-3 -> 3, 4+ -> 4), Commander Spellbook /estimate-bracket tag (E/C -> 2, O/P/S -> 3, R -> 4)). Core is the baseline the brackets set for a modern precon; the Spellbook tag is a MINIMUM from contents (Game Changers, land denial, extra turns, combos), not a read of how the list plays.',
    cedh: 'EDHTop16 top-8 finishes at the six largest cEDH events of the three months to the build date; label 5.',
    scrollvault: 'ScrollVault precon library, a second opinion: never the label.',
    unknownCards: unknown,
  },
  decks,
  cards,
  combos,
  tags: tagSubset,
};

const outAt = args.indexOf('--out');
fs.writeFileSync(
  outAt >= 0 ? args[outAt + 1] : path.join(HERE, 'fixtures/corpus.json'),
  JSON.stringify(corpus)
);
console.log(
  `decks ${decks.length} (precon ${decks.filter((d) => d.set === 'precon').length}, cedh ${
    decks.filter((d) => d.set === 'cedh').length
  }, synthetic ${decks.filter((d) => d.set === 'synthetic').length}); cards ${
    Object.keys(cards).length
  } (${unknown.length} unknown, ${fetchedEarly + fetchedLate} looked up without text); combos ${
    Object.keys(combos).length
  }`
);
