#!/usr/bin/env node
// Builds the substitute-similarity evaluation fixture: for a seed set of real
// Commander staples, fetch EDHREC's per-card `similar` list (its own
// deck-co-occurrence answer to "what replaces this card") plus the type line +
// mana value for every card involved. The fixture is the INDEPENDENT ground
// truth the weight-calibration eval tunes against — EDHREC's similarity is
// derived from millions of real decks and owes nothing to our tagger tags, so
// validating the heuristic against it is not circular.
//
// Run manually:  node scripts/fetch-edhrec-similar.mjs
// Network, dev-time only. The emitted fixture is checked in; the eval/regression
// test reads it offline.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DEST = resolve(
  here,
  '..',
  'src',
  'deck-builder',
  'services',
  'deckBuilder',
  '__fixtures__',
  'edhrec-similar.fixture.json'
);

// Representative staples across every role the substitute finder ranks within
// (ramp / mana-rock / spot-removal / boardwipe / card draw / tutor / counter).
// EDHREC's `similar` lists expand this into the full candidate universe.
const SEED = [
  // mana rocks
  'Sol Ring', 'Arcane Signet', 'Mind Stone', 'Fellwar Stone', 'Thought Vessel',
  'Worn Powerstone', 'Thran Dynamo', 'Hedron Archive', 'Coldsteel Heart', 'Star Compass',
  // ramp spells / dorks
  'Cultivate', "Kodama's Reach", 'Rampant Growth', 'Farseek', "Nature's Lore",
  'Three Visits', 'Sakura-Tribe Elder', 'Birds of Paradise', 'Llanowar Elves', 'Wood Elves',
  'Explosive Vegetation', 'Skyshroud Claim', 'Migration Path', 'Circuitous Route',
  // spot removal
  'Swords to Plowshares', 'Path to Exile', 'Beast Within', 'Generous Gift', 'Chaos Warp',
  'Pongify', 'Rapid Hybridization', 'Anguished Unmaking', 'Mortify', 'Go for the Throat',
  'Murder', "Hero's Downfall", 'Vraska’s Contempt', 'Despark', 'Assassin’s Trophy',
  // board wipes
  'Wrath of God', 'Damnation', 'Blasphemous Act', 'Toxic Deluge', 'Supreme Verdict',
  'Austere Command', 'Farewell', 'Vandalblast', 'Cyclonic Rift', 'Brutal Cathar',
  // card draw / advantage
  'Rhystic Study', 'Mystic Remora', 'Phyrexian Arena', 'Sign in Blood', 'Night’s Whisper',
  'Harmonize', "Esper Sentinel", 'Guardian Project', 'Beast Whisperer', 'The Great Henge',
  'Fact or Fiction', 'Read the Bones', 'Painful Truths',
  // tutors
  'Demonic Tutor', 'Vampiric Tutor', 'Diabolic Intent', 'Enlightened Tutor', 'Mystical Tutor',
  'Worldly Tutor', 'Eladamri’s Call', 'Idyllic Tutor', 'Diabolic Tutor',
  // counterspells / interaction
  'Counterspell', 'Swan Song', 'Negate', 'Dovin’s Veto', 'Arcane Denial',
  'An Offer You Can’t Refuse', 'Mana Drain', 'Fierce Guardianship', 'Delay',
  // utility / staples
  'Lightning Greaves', 'Swiftfoot Boots', 'Skullclamp', 'Smothering Tithe', "Dockside Extortionist",
  'Heroic Intervention', 'Teferi’s Protection', 'Eternal Witness', 'Reclamation Sage',
];

// Canonical name form — Scryfall and EDHREC both emit straight apostrophes; the
// seed list mixes curly ones, so normalize before keying/matching.
const canon = (name) => name.replace(/[’]/g, "'");

const slug = (name) =>
  canon(name)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/'/g, '') // drop apostrophes (kodama's -> kodamas)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EDHREC_HEADERS = { 'User-Agent': 'spellcontrol-eval/1.0' };

async function fetchSimilar(name) {
  const url = `https://json.edhrec.com/pages/cards/${slug(name)}.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const j = await res.json();
    return Array.isArray(j.similar) ? j.similar : [];
  } catch {
    return null;
  }
}

// Scryfall /cards/collection — 75 identifiers per POST, returns type_line + cmc.
async function fetchMetadata(names) {
  const meta = {};
  for (let i = 0; i < names.length; i += 75) {
    const batch = names.slice(i, i + 75);
    const res = await fetch('https://api.scryfall.com/cards/collection', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'spellcontrol-eval/1.0',
        Accept: 'application/json',
      },
      body: JSON.stringify({ identifiers: batch.map((n) => ({ name: n })) }),
    });
    if (res.ok) {
      const j = await res.json();
      for (const c of j.data ?? []) {
        meta[c.name] = { typeLine: c.type_line ?? '', cmc: c.cmc ?? 0 };
      }
    }
    await sleep(120); // Scryfall asks for ~100ms between requests
  }
  return meta;
}

async function buildSimilarFixture() {
  console.log(`[eval-fixture] fetching EDHREC similar for ${SEED.length} seed staples…`);
  const similar = {};
  let ok = 0;
  for (const name of SEED) {
    const sim = await fetchSimilar(name);
    if (sim && sim.length) {
      similar[canon(name)] = sim.map(canon);
      ok++;
    } else {
      console.warn(`[eval-fixture]   no similar for "${name}" (slug ${slug(name)})`);
    }
    await sleep(80); // be polite to EDHREC
  }
  console.log(`[eval-fixture] got similar lists for ${ok}/${SEED.length} seeds`);

  // The full card universe = seeds + everything in their similar lists.
  const universe = new Set();
  for (const [name, sim] of Object.entries(similar)) {
    universe.add(name);
    for (const s of sim) universe.add(s);
  }
  console.log(`[eval-fixture] resolving type/cmc for ${universe.size} cards via Scryfall…`);
  const cards = await fetchMetadata([...universe]);
  console.log(`[eval-fixture] resolved metadata for ${Object.keys(cards).length} cards`);

  const fixture = {
    generatedAt: new Date().toISOString(),
    source: 'json.edhrec.com/pages/cards/{slug}.json (similar[]) + api.scryfall.com/cards/collection',
    note: 'Independent ground truth for substitute-weight calibration. similar[] is EDHREC deck-co-occurrence; metadata is Scryfall type/cmc.',
    cards, // name -> { typeLine, cmc }
    similar, // seedName -> [similar card names, EDHREC-ranked]
  };

  await mkdir(dirname(DEST), { recursive: true });
  await writeFile(DEST, JSON.stringify(fixture, null, 2) + '\n');
  console.log(`[eval-fixture] wrote ${DEST}`);
}

// ---------------------------------------------------------------------------
// --lift mode: held-out lift-eval corpus for liftSynergy (E71 slice 1).
//
// For each of ~24 mechanically diverse commanders: `context` = its own top-6
// "top cards" (deterministic), `positives` = its "high synergy cards" (the
// held-out ground truth — never fed to the ranker), and `liftPools` = the
// context cards' own card-page lift lists (what a lift-based ranker would
// actually see at generation time). The commander's own card page is never
// fetched — that would leak the positives signal back into the pools.
// ---------------------------------------------------------------------------

const LIFT_DEST = resolve(
  here,
  '..',
  'src',
  'deck-builder',
  'services',
  'deckBuilder',
  '__fixtures__',
  'edhrec-lift.fixture.json'
);

const COMMANDERS = [
  'Krenko, Mob Boss',
  'Meren of Clan Nel Toth',
  'Talrand, Sky Summoner',
  'Urza, Lord High Artificer',
  'Lord Windgrace',
  "Sythis, Harvest's Hand",
  'Rhys the Redeemed',
  'Muldrotha, the Gravetide',
  "Atraxa, Praetors' Voice",
  'Trelasarra, Moon Dancer',
  'Wyleth, Soul of Steel',
  'Prosper, Tome-Bound',
  'The Ur-Dragon',
  'Wilhelt, the Rotcleaver',
  'Lathril, Blade of the Elves',
  'Bruvac the Grandiloquent',
  "Yuriko, the Tiger's Shadow",
  'Edgar Markov',
  'Chulane, Teller of Tales',
  'Korvold, Fae-Cursed King',
  'Isshin, Two Heavens as One',
  'Teysa Karlov',
  'Kess, Dissident Mage',
  "Gishath, Sun's Avatar",
];

const NON_LIFT_POOL_TAGS = new Set(['topcommanders', 'newcommanders', 'newcards']);

async function fetchJson(url) {
  try {
    const res = await fetch(url, { headers: EDHREC_HEADERS });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchCommanderPage(name) {
  const j = await fetchJson(`https://json.edhrec.com/pages/commanders/${slug(name)}.json`);
  return j?.container?.json_dict?.cardlists ?? null;
}

function cardviewNames(cardlists, tag) {
  const list = cardlists.find((c) => c.tag === tag);
  return (list?.cardviews ?? []).map((cv) => canon(cv.name)).filter(Boolean);
}

// Card page -> lift tuples for every list except commander-recommendation lists.
async function fetchLiftTuples(cardName) {
  const j = await fetchJson(`https://json.edhrec.com/pages/cards/${slug(cardName)}.json`);
  const cardlists = j?.container?.json_dict?.cardlists;
  if (!Array.isArray(cardlists)) return [];

  const byName = new Map(); // name -> [name, lift, numDecks, potentialDecks]
  for (const list of cardlists) {
    if (NON_LIFT_POOL_TAGS.has(list.tag)) continue;
    for (const cv of list.cardviews ?? []) {
      const name = canon(cv.name ?? '');
      const lift = cv.lift;
      const numDecks = cv.num_decks ?? cv.inclusion;
      if (!name || !(lift > 0) || !(numDecks >= 12)) continue;
      const existing = byName.get(name);
      if (!existing || lift > existing[1]) {
        byName.set(name, [name, lift, numDecks, cv.potential_decks ?? 0]);
      }
    }
  }

  const all = [...byName.values()];
  return capLiftPool(all);
}

// Union of top-N-by-lift and top-N-by-coplay-ratio. 120/120 pushed the fixture
// to ~2.3MB (over the 1.5MB guard); 70/70 lands at ~1.4MB.
function capLiftPool(tuples, cap = 70) {
  const byLift = [...tuples].sort((a, b) => b[1] - a[1]).slice(0, cap);
  const byCoplay = [...tuples]
    .sort((a, b) => b[2] / (b[3] || 1) - a[2] / (a[3] || 1))
    .slice(0, cap);
  const seen = new Map();
  for (const t of [...byLift, ...byCoplay]) seen.set(t[0], t);
  return [...seen.values()];
}

async function buildLiftFixture() {
  console.log(`[lift-fixture] fetching ${COMMANDERS.length} commander pages…`);
  const queries = [];
  const dropped = [];
  const perCommanderPool = []; // { commander, context, positives, topcards }

  for (const commander of COMMANDERS) {
    const cardlists = await fetchCommanderPage(commander);
    await sleep(100);
    if (!cardlists) {
      dropped.push(`${commander} (commander page 404)`);
      continue;
    }
    const topcards = cardviewNames(cardlists, 'topcards');
    const context = topcards.slice(0, 6);
    const contextSet = new Set(context);
    const positives = cardviewNames(cardlists, 'highsynergycards')
      .filter((n) => !contextSet.has(n))
      .slice(0, 15);
    if (positives.length < 5) {
      dropped.push(`${commander} (only ${positives.length} positives after context exclusion)`);
      continue;
    }
    if (context.length < 6) {
      dropped.push(`${commander} (only ${context.length} top-cards for context)`);
      continue;
    }
    perCommanderPool.push({ commander, context, positives, topcards: new Set(topcards) });
  }

  console.log(`[lift-fixture] ${perCommanderPool.length}/${COMMANDERS.length} commanders usable`);
  if (dropped.length) {
    console.warn(`[lift-fixture] dropped:\n  ${dropped.join('\n  ')}`);
  }

  // Deterministic round-robin distractor sampling: for each commander, walk
  // every OTHER commander's positives+context in a fixed order, skipping
  // anything that appears in this commander's own positives/context/topcards.
  for (const entry of perCommanderPool) {
    const own = new Set([...entry.positives, ...entry.context, ...entry.topcards]);
    const wantCount = entry.positives.length * 3;
    const others = perCommanderPool.filter((o) => o !== entry);
    const pools = others.map((o) => [...o.positives, ...o.context]);
    const distractors = [];
    const seen = new Set();
    let round = 0;
    while (distractors.length < wantCount && pools.some((p) => round < p.length)) {
      for (const pool of pools) {
        if (distractors.length >= wantCount) break;
        const name = pool[round];
        if (name && !own.has(name) && !seen.has(name)) {
          seen.add(name);
          distractors.push(name);
        }
      }
      round++;
    }
    queries.push({
      commander: entry.commander,
      context: entry.context,
      positives: entry.positives,
      distractors,
    });
  }

  // Fetch card-page lift pools for every distinct context card across all queries.
  const contextCards = [...new Set(queries.flatMap((q) => q.context))];
  console.log(`[lift-fixture] fetching lift pools for ${contextCards.length} context cards…`);
  const liftPools = {};
  for (const name of contextCards) {
    liftPools[name] = await fetchLiftTuples(name);
    if (liftPools[name].length === 0) {
      console.warn(`[lift-fixture]   empty lift pool for "${name}" (slug ${slug(name)})`);
    }
    await sleep(100);
  }

  const fixture = {
    generatedAt: new Date().toISOString(),
    source: 'json.edhrec.com/pages/commanders/{slug}.json + json.edhrec.com/pages/cards/{slug}.json',
    note:
      "Held-out lift-eval corpus for liftSynergy: positives = each commander's own high-synergy list (never an input to the ranker); liftPools = context cards' card-page lift lists as [name, lift, numDecks, potentialDecks] tuples, pre-filtered numDecks>=12, capped top-70-by-lift ∪ top-70-by-coplay. Regenerate: node scripts/fetch-edhrec-similar.mjs --lift",
    queries,
    liftPools,
  };

  await mkdir(dirname(LIFT_DEST), { recursive: true });
  const json = JSON.stringify(fixture, null, 2) + '\n';
  await writeFile(LIFT_DEST, json);
  console.log(
    `[lift-fixture] wrote ${LIFT_DEST} (${queries.length} queries, ${Buffer.byteLength(json)} bytes)`
  );
}

if (process.argv.includes('--lift')) {
  await buildLiftFixture();
} else {
  await buildSimilarFixture();
}
