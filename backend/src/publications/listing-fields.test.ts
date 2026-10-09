import { describe, it, expect } from 'vitest';
import { extractListingFields } from './listing-fields';
import { DECK_NAME_MAX, projectDeck } from '../shares/projections';

/** A realistic deck fixture matching the frontend's `Deck` shape closely
 *  enough to exercise every extracted field. */
function baseDeck(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'd-1',
    name: 'Atraxa Superfriends',
    format: 'commander',
    commander: {
      id: 'atraxa',
      name: "Atraxa, Praetors' Voice",
      color_identity: ['W', 'U', 'B', 'G'],
      image_uris: {
        normal: 'https://cards.scryfall.io/normal/atraxa.jpg',
        art_crop: 'https://cards.scryfall.io/art_crop/atraxa.jpg',
      },
    },
    partnerCommander: null,
    cards: [{ slotId: 's1', card: { id: 'sol-ring', name: 'Sol Ring' }, allocatedCopyId: null }],
    sideboard: [],
    ...overrides,
  };
}

describe('extractListingFields', () => {
  it('extracts name/format/commander/colorIdentity/bracket/cardCount from a realistic deck fixture', () => {
    const fields = extractListingFields(baseDeck({ bracketEstimation: { bracket: 3 } }));
    expect(fields).toMatchObject({
      name: 'Atraxa Superfriends',
      format: 'commander',
      commanderName: "Atraxa, Praetors' Voice",
      commanderImageNormal: 'https://cards.scryfall.io/normal/atraxa.jpg',
      colorIdentity: ['W', 'U', 'B', 'G'],
      bracket: 3,
      cardCount: 2, // commander + 1 mainboard card
    });
  });

  it('counts only the slots the public deck page renders (board E343)', () => {
    // `cardCount` is the /d/:slug link preview's "N cards" and the /u/ tile's
    // count. A slot with no `card` is one the page drops, so promising it is
    // the same off-by-one the collection unfurl had.
    const cards = [
      { slotId: 's1', card: { id: 'sol-ring', name: 'Sol Ring' } },
      { slotId: 's2', allocatedCopyId: null },
    ];
    const deck = baseDeck({ cards });
    const fields = extractListingFields(deck);
    const rendered = projectDeck({ username: 'u', displayName: null }, deck)!.cards.length;
    expect(rendered).toBe(1);
    // commander + the one slot the page can render.
    expect(fields!.cardCount).toBe(1 + rendered);
  });

  it('clamps the name it publishes, which is the title and the tile (board E342)', () => {
    // `deck_name` is the /d/:slug <title>, its og:title, the hero h1 and the
    // /u/ tile. A 400-character name filled all four.
    const fields = extractListingFields(baseDeck({ name: 'q'.repeat(400) }));
    expect(fields!.name.length).toBe(DECK_NAME_MAX);
    expect(fields!.name).toBe('q'.repeat(DECK_NAME_MAX));
  });

  it('returns null for a non-object', () => {
    expect(extractListingFields('not a deck')).toBeNull();
    expect(extractListingFields(null)).toBeNull();
    expect(extractListingFields(undefined)).toBeNull();
    expect(extractListingFields(42)).toBeNull();
  });

  it('returns null for a missing or empty name', () => {
    expect(extractListingFields(baseDeck({ name: undefined }))).toBeNull();
    expect(extractListingFields(baseDeck({ name: '' }))).toBeNull();
  });

  it('prefers bracketOverride over bracketEstimation.bracket over null', () => {
    expect(
      extractListingFields(baseDeck({ bracketOverride: 5, bracketEstimation: { bracket: 2 } }))
        ?.bracket
    ).toBe(5);
    expect(extractListingFields(baseDeck({ bracketEstimation: { bracket: 2 } }))?.bracket).toBe(2);
    expect(extractListingFields(baseDeck())?.bracket).toBeNull();
  });

  // estimatedBracket is ALWAYS the raw estimate — never bracketOverride — so a
  // stated bracket can never hide what the deck actually estimates at in a
  // listing (2026-09-24 ruling).
  it('estimatedBracket is the raw estimate regardless of a stated override', () => {
    expect(
      extractListingFields(baseDeck({ bracketOverride: 5, bracketEstimation: { bracket: 2 } }))
        ?.estimatedBracket
    ).toBe(2);
    expect(
      extractListingFields(baseDeck({ bracketEstimation: { bracket: 2 } }))?.estimatedBracket
    ).toBe(2);
    expect(extractListingFields(baseDeck())?.estimatedBracket).toBeNull();
  });

  // ── ogArtCrop (ORCHESTRATOR AMENDMENT — resolved via cardArtUrl, not a
  //    derived /normal/ -> /art_crop/ string replace) ─────────────────────
  it('resolves ogArtCrop from the commander art_crop', () => {
    expect(extractListingFields(baseDeck())?.ogArtCrop).toBe(
      'https://cards.scryfall.io/art_crop/atraxa.jpg'
    );
  });

  it('falls back to the partner commander when the commander has no art', () => {
    const fields = extractListingFields(
      baseDeck({
        commander: null,
        partnerCommander: {
          id: 'partner',
          name: 'Partner Commander',
          image_uris: { art_crop: 'https://cards.scryfall.io/art_crop/partner.jpg' },
        },
      })
    );
    expect(fields?.ogArtCrop).toBe('https://cards.scryfall.io/art_crop/partner.jpg');
  });

  it('falls back to the mainboard for a non-commander deck', () => {
    const fields = extractListingFields(
      baseDeck({
        format: 'standard',
        commander: null,
        partnerCommander: null,
        cards: [
          {
            slotId: 's1',
            card: {
              id: 'bolt',
              name: 'Lightning Bolt',
              image_uris: { art_crop: 'https://cards.scryfall.io/art_crop/bolt.jpg' },
            },
            allocatedCopyId: null,
          },
        ],
      })
    );
    expect(fields?.ogArtCrop).toBe('https://cards.scryfall.io/art_crop/bolt.jpg');
  });

  it("wears the same cover the owner sees: their pick, else the deck's 4-of over a pricier land", () => {
    const slot = (id: string, card: Record<string, unknown>) => ({
      slotId: id,
      card: { image_uris: { art_crop: `https://cards.scryfall.io/art_crop/${id}.jpg` }, ...card },
      allocatedCopyId: null,
    });
    const terror = { name: 'Tolarian Terror', type_line: 'Creature', prices: { usd: '0.2' } };
    const cards = [
      slot('land', { name: 'Scalding Tarn', type_line: 'Land', prices: { usd: '30' } }),
      slot('one', { name: 'Pricey One-of', type_line: 'Instant', prices: { usd: '3' } }),
      slot('terror', terror),
      slot('terror', terror),
      slot('terror', terror),
      slot('terror', terror),
    ];
    const deck = { format: 'pauper', commander: null, cards };
    expect(extractListingFields(baseDeck(deck))?.ogArtCrop).toBe(
      'https://cards.scryfall.io/art_crop/terror.jpg'
    );
    expect(
      extractListingFields(baseDeck({ ...deck, coverCardName: 'Pricey One-of' }))?.ogArtCrop
    ).toBe('https://cards.scryfall.io/art_crop/one.jpg');
  });

  // A non-commander deck's colors come from its cards, as on the owner's own
  // deck index. Reading only the commander left every Pauper deck colorless on
  // Discover and /u/:username: no pips, a gray strip.
  it('colors a non-commander deck from its cards, most-used color first', () => {
    const slot = (name: string, color_identity: string[]) => ({
      slotId: name,
      card: { id: name, name, color_identity },
      allocatedCopyId: null,
    });
    const fields = extractListingFields(
      baseDeck({
        format: 'pauper',
        commander: null,
        partnerCommander: null,
        cards: [
          slot('Llanowar Elves', ['G']),
          slot('Llanowar Elves', ['G']),
          slot('Llanowar Elves', ['G']),
          slot('Deathrite Shaman', ['B', 'G']),
          slot('Forest', []),
        ],
        sideboard: [slot('Duress', ['B']), slot('Duress', ['B']), slot('Pyroblast', ['R'])],
      })
    );
    // G ×4, B ×3 (one mainboard, two sideboard), R ×1.
    expect(fields?.colorIdentity).toEqual(['G', 'B', 'R']);
  });

  it('breaks color-count ties in WUBRG order', () => {
    const fields = extractListingFields(
      baseDeck({
        format: 'pauper',
        commander: null,
        cards: [
          { slotId: 'a', card: { name: 'Bolt', color_identity: ['R'] } },
          { slotId: 'b', card: { name: 'Counterspell', color_identity: ['U'] } },
        ],
      })
    );
    expect(fields?.colorIdentity).toEqual(['U', 'R']);
  });

  it('keeps a commander deck on its commander identity, not its cards', () => {
    const fields = extractListingFields(
      baseDeck({
        cards: [{ slotId: 's1', card: { name: 'Lightning Bolt', color_identity: ['R'] } }],
      })
    );
    expect(fields?.colorIdentity).toEqual(['W', 'U', 'B', 'G']);
  });

  it('is null when nothing has art', () => {
    const fields = extractListingFields(
      baseDeck({
        commander: { id: 'x', name: 'No Art' },
        partnerCommander: null,
        cards: [{ slotId: 's1', card: { id: 'y', name: 'Also No Art' }, allocatedCopyId: null }],
      })
    );
    expect(fields?.ogArtCrop).toBeNull();
  });
});
