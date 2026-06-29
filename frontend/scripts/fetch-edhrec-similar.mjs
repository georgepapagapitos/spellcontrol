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
