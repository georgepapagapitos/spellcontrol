/**
 * Products MTGJSON hasn't catalogued yet, so the product search can offer a
 * precon the day it ships. MTGJSON can lag weeks behind a Secret Lair drop:
 * Odds and Ends shipped 2026-09-28 and was still absent from DeckList.json on
 * 2026-10-07. Each entry is shaped like an MTGJSON deck file, so it resolves
 * through the same rows (set + collector number pin the new-art foils). An
 * entry retires itself: once MTGJSON lists a product of the same set whose
 * name contains this one, MTGJSON's entry is used and this one is dropped.
 *
 * Adding one: copy the official decklist, pin each product-exclusive printing
 * by Scryfall set + collector number, and leave reprints and basics by name.
 */
import type { MtgjsonDeckFile } from './product-map';

export interface PendingProduct {
  fileName: string;
  deck: MtgjsonDeckFile;
}

export const PENDING_PRODUCTS: readonly PendingProduct[] = [
  {
    // https://magic.wizards.com/en/news/announcements/secret-lair-commander-deck-odds-and-ends-decklist
    // The 4 foil Oddlands basics aren't pinned: the list doesn't say which 4.
    fileName: 'pending-OddsAndEnds_SLD',
    deck: {
      name: 'Secret Lair Commander Deck: Odds and Ends',
      code: 'SLD',
      type: 'Commander Deck',
      releaseDate: '2026-09-28',
      commander: [
        {
          count: 1,
          name: 'Yennett, Cryptic Sovereign',
          setCode: 'SLD',
          number: '2121',
          isFoil: true,
        },
      ],
      mainBoard: [
        { count: 1, name: 'Void Winnower', setCode: 'SLD', number: '2122', isFoil: true },
        { count: 1, name: 'Esper Sentinel', setCode: 'SLD', number: '2123', isFoil: true },
        { count: 1, name: 'Reconnaissance', setCode: 'SLD', number: '2124', isFoil: true },
        { count: 1, name: 'Swords to Plowshares', setCode: 'SLD', number: '2125', isFoil: true },
        { count: 1, name: 'Weathered Wayfarer', setCode: 'SLD', number: '2126', isFoil: true },
        { count: 1, name: 'Misleading Signpost', setCode: 'SLD', number: '2127', isFoil: true },
        { count: 1, name: 'Breach the Multiverse', setCode: 'SLD', number: '2128', isFoil: true },
        { count: 1, name: 'Virtue of Persistence', setCode: 'SLD', number: '2129', isFoil: true },
        { count: 1, name: 'Shadrix Silverquill', setCode: 'SLD', number: '2130', isFoil: true },
        { count: 1, name: "Sensei's Divining Top", setCode: 'SLD', number: '2131', isFoil: true },
        { count: 1, name: 'Sol Ring', setCode: 'SLD', number: '2132', isFoil: true },
        { count: 1, name: 'Aboleth Spawn' },
        { count: 1, name: 'Adarkar Wastes' },
        { count: 1, name: 'Aeon Engine' },
        { count: 1, name: 'Aerial Extortionist' },
        { count: 1, name: 'Aminatou, the Fateshifter' },
        { count: 1, name: 'Approach of the Second Sun' },
        { count: 1, name: 'Arcane Sanctum' },
        { count: 1, name: 'Arcane Signet' },
        { count: 1, name: 'Brainstorm' },
        { count: 1, name: 'Breena, the Demagogue' },
        { count: 1, name: 'Caves of Koilos' },
        { count: 1, name: 'Chaos Wand' },
        { count: 1, name: 'Claim Jumper' },
        { count: 1, name: 'Coalition Relic' },
        { count: 1, name: 'Command Beacon' },
        { count: 1, name: 'Command Tower' },
        { count: 1, name: "Commander's Sphere" },
        { count: 1, name: 'Contaminated Landscape' },
        { count: 1, name: 'Dazzling Sphinx' },
        { count: 1, name: 'Doom Whisperer' },
        { count: 1, name: 'Drowned Catacomb' },
        { count: 1, name: 'Enigma Sphinx' },
        { count: 1, name: 'Ethersworn Sphinx' },
        { count: 1, name: 'Evolving Wilds' },
        { count: 1, name: 'Exchange of Words' },
        { count: 1, name: 'Exotic Orchard' },
        { count: 1, name: 'Extinction Event' },
        { count: 1, name: 'Fabled Passage' },
        { count: 1, name: 'Fatespinner' },
        { count: 1, name: 'Fractured Identity' },
        { count: 1, name: 'Glacial Fortress' },
        { count: 1, name: 'Imprisoned in the Moon' },
        { count: 1, name: 'Inniaz, the Gale Force' },
        { count: 1, name: 'Isolated Chapel' },
        { count: 1, name: 'Jeskai Infiltrator' },
        { count: 1, name: 'Leadership Vacuum' },
        { count: 1, name: 'Loran of the Third Path' },
        { count: 1, name: 'Marvo, Deep Operative' },
        { count: 1, name: 'Master of Predicaments' },
        { count: 1, name: 'Mirage Mirror' },
        { count: 1, name: 'Myriad Landscape' },
        { count: 1, name: 'Mystic Gate' },
        { count: 1, name: 'Nadir Kraken' },
        { count: 1, name: 'Oubliette' },
        { count: 1, name: 'Path of Ancestry' },
        { count: 1, name: "Planeswalker's Mischief" },
        { count: 1, name: 'Ponder' },
        { count: 1, name: 'Prairie Stream' },
        { count: 1, name: 'Profane Transfusion' },
        { count: 1, name: 'Promise of Loyalty' },
        { count: 1, name: 'Psychic Battle' },
        { count: 1, name: 'Rapid Hybridization' },
        { count: 1, name: 'Reliquary Tower' },
        { count: 1, name: 'Shared Fate' },
        { count: 1, name: 'Silent Clearing' },
        { count: 1, name: 'Skyclave Apparition' },
        { count: 1, name: 'Skyclave Relic' },
        { count: 1, name: "Smuggler's Share" },
        { count: 1, name: 'Soothsaying' },
        { count: 1, name: 'Space Beleren' },
        { count: 1, name: 'Sunken Hollow' },
        { count: 1, name: 'Swift Reconfiguration' },
        { count: 1, name: 'Talisman of Progress' },
        { count: 1, name: 'Temple of Deceit' },
        { count: 1, name: 'Temple of Enlightenment' },
        { count: 1, name: 'Temple of Silence' },
        { count: 1, name: 'Terramorphic Expanse' },
        { count: 1, name: 'Thief of Sanity' },
        { count: 1, name: 'Time Stop' },
        { count: 1, name: 'Toxrill, the Corrosive' },
        { count: 1, name: 'Underground River' },
        { count: 1, name: 'Vega, the Watcher' },
        { count: 1, name: "Venser's Journal" },
        { count: 1, name: 'Vesuvan Drifter' },
        { count: 1, name: "Wayfarer's Bauble" },
        { count: 1, name: 'Yavimaya, Cradle of Growth' },
        { count: 4, name: 'Plains' },
        { count: 4, name: 'Island' },
        { count: 4, name: 'Swamp' },
      ],
    },
  },
];
