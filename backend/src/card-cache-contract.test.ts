import { describe, expect, it } from 'vitest';
import { projectBulkCard } from './scryfall-bulk';

/**
 * The card cache's field contract.
 *
 * `projectBulkCard` is a WHITELIST: it decides, for ~107k cards, what the
 * entire app is able to know about a card. A field left out of it does not
 * fail anywhere — the reader just sees `undefined` and carries on, so the
 * feature that needed it quietly does the wrong thing forever.
 *
 * That happened five times before this test existed. `power`/`toughness`
 * meant the playtest board could never print a real body. `tokens` meant
 * BOTH token checklists ("Tokens to prep" and the playtest token picker)
 * reported that every deck in the app makes no tokens. `produced_mana`
 * meant a Command Tower produced no colours as far as the mana-base
 * analysis was concerned. `keywords` meant partner, flash and changeling
 * detection all read as absent. Every one was found by a human noticing a
 * feature was wrong, never by a test.
 *
 * So this is the guard: each entry names a field, what reads it, and what
 * breaks without it. Dropping one from the projection now fails here with
 * that sentence attached.
 *
 * ⚠️ Adding a row is cheap; deleting one needs a reason. If a reader really
 * has gone away, delete the row in the same commit as the reader — do not
 * loosen the test to make a red build green.
 */
const CONTRACT: ReadonlyArray<{ field: string; readBy: string }> = [
  // Identity and lookup
  { field: 'id', readBy: 'every printing-level lookup and image resolve' },
  { field: 'oracle_id', readBy: 'combo matching, deck dedupe, tagger joins' },
  { field: 'name', readBy: 'everything' },
  // Rules text and cost
  { field: 'mana_cost', readBy: 'the hand fan’s cost badge, curve analysis' },
  { field: 'cmc', readBy: 'curve analysis, bracket estimation' },
  { field: 'type_line', readBy: 'row classification, auto-place, land counting' },
  { field: 'oracle_text', readBy: 'the AI grounding facts, rules search, tagging' },
  { field: 'colors', readBy: 'colour analysis' },
  { field: 'color_identity', readBy: 'commander legality, binder routing' },
  { field: 'legalities', readBy: 'format legality checks' },
  // The body of a permanent
  { field: 'power', readBy: 'the playtest board’s P/T box' },
  { field: 'toughness', readBy: 'the playtest board’s P/T box' },
  { field: 'loyalty', readBy: 'the card detail and preview panes' },
  // Derived relationships
  { field: 'tokens', readBy: '"Tokens to prep" and the playtest token picker' },
  { field: 'produced_mana', readBy: 'mana-base analysis, cost analyzer, lib/mana-sources' },
  { field: 'keywords', readBy: 'partner detection, flash/changeling checks, commander profile' },
  // Printing-level facts
  { field: 'set', readBy: 'binder grouping and set filters' },
  { field: 'set_name', readBy: 'card detail, binder labels' },
  { field: 'collector_number', readBy: 'printing identity, binder sort' },
  { field: 'released_at', readBy: 'the binder’s Release-date sort (printing-level, not set)' },
  { field: 'rarity', readBy: 'rarity filters and binder rules' },
  { field: 'finishes', readBy: 'foil/etched availability' },
  { field: 'frame_effects', readBy: 'showcase/extended-art filters' },
  { field: 'promo_types', readBy: 'specialty-foil filters' },
  { field: 'full_art', readBy: 'full-art land filters (older sets set only this)' },
  { field: 'border_color', readBy: 'borderless filters' },
  { field: 'layout', readBy: 'the playable-card filter, DFC handling' },
  { field: 'games', readBy: 'Arena-only filtering' },
  { field: 'flavor_text', readBy: 'the card detail pane' },
  { field: 'image_uris', readBy: 'every card image in the app' },
  { field: 'prices', readBy: 'deck and collection valuation' },
  { field: 'edhrec_rank', readBy: 'deck generation and suggestion ordering' },
  { field: 'card_faces', readBy: 'double-faced cards — the back face lives only here' },
];

/** A bulk row carrying every field the contract names, so a projection that
 *  drops one is the only way an assertion below can fail. */
function fullCard() {
  return {
    id: 'sf-1',
    oracle_id: 'o-1',
    name: 'Contract Card',
    mana_cost: '{2}{R}',
    cmc: 3,
    type_line: 'Creature — Goblin',
    oracle_text: 'Haste.',
    colors: ['R'],
    color_identity: ['R'],
    legalities: { commander: 'legal' },
    power: '2',
    toughness: '2',
    loyalty: '4',
    all_parts: [{ component: 'token', name: 'Goblin', type_line: 'Token Creature — Goblin' }],
    produced_mana: ['R'],
    keywords: ['Haste'],
    set: 'cmr',
    set_name: 'Commander Legends',
    collector_number: '472',
    released_at: '2020-11-20',
    rarity: 'rare',
    finishes: ['nonfoil', 'foil'],
    frame_effects: ['showcase'],
    promo_types: ['textured'],
    full_art: true,
    border_color: 'black',
    layout: 'normal',
    games: ['paper'],
    flavor_text: 'A contract is a contract.',
    image_uris: { normal: 'https://img/normal.jpg' },
    prices: { usd: '1.00' },
    edhrec_rank: 100,
    // A real value, because the per-field loop below asserts every contract
    // field is present; the dedicated DFC test then proves both faces survive.
    card_faces: [{ name: 'Contract Card' }],
  };
}

describe('the card cache field contract', () => {
  const projected = projectBulkCard(fullCard() as never);

  it('projects a card at all', () => {
    expect(projected).not.toBeNull();
  });

  // One assertion per field, so a failure names the field and its reader
  // rather than dumping a whole-object diff.
  it.each(CONTRACT)('keeps $field — read by $readBy', ({ field }) => {
    expect(
      projected?.[field as keyof typeof projected],
      `projectBulkCard dropped "${field}". Without it the app silently reads undefined.`
    ).toBeDefined();
  });

  // Both directions, automatically: a field ADDED to the projection without
  // a contract row fails here too. That is what stops this list from
  // quietly becoming a stale subset of what the cache actually stores —
  // the failure mode a hand-maintained checklist always drifts into.
  it('names every field the projection keeps, and no others', () => {
    const projectedKeys = Object.keys(projected ?? {}).sort();
    const contractKeys = CONTRACT.map((c) => c.field).sort();
    expect(
      projectedKeys,
      'projectBulkCard and CONTRACT have drifted — add or remove the row in the same commit as the field.'
    ).toEqual(contractKeys);
  });

  // `card_faces` is the one contract field a single-faced card legitimately
  // lacks, so it gets its own assertion against a card that HAS faces.
  it('keeps card_faces on a double-faced card', () => {
    const dfc = projectBulkCard({
      ...fullCard(),
      layout: 'transform',
      card_faces: [{ name: 'Front' }, { name: 'Back' }],
    } as never);
    expect(dfc?.card_faces).toHaveLength(2);
  });
});
