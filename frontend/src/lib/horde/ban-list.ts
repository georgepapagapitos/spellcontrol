/**
 * hordemagic.com's Horde-format ban list — cards that break a horde-vs-
 * survivors game (Vanguard-turn cheating, an unkillable hard-stop, a Horde
 * that can never lose). Checked as a soft warning on the setup screen
 * (design point 1): named, never blocking Start. A horde is a house-rule
 * kitchen-table format, so the app never enforces this — it just tells you
 * before you sit down.
 */
export const HORDE_BAN_LIST: readonly string[] = [
  'Elesh Norn, Grand Cenobite',
  'Magus of the Moat',
  'Massacre Wurm',
  'Plague Engineer',
  'Platinum Angel',
  'Platinum Emperion',
  'Rampaging Ferocidon',
  'Silent Arbiter',
  'Stormtide Leviathan',
  'Urabrask the Hidden',
  'Aether Flash',
  'Aurification',
  'Authority of the Consuls',
  'Barbed Foliage',
  'Blind Obedience',
  'Dueling Grounds',
  'Island Sanctuary',
  'Lethal Vapors',
  'Leyline of Singularity',
  'No Mercy',
  'Pyrohemia',
  'Rest in Peace',
  'Solitary Confinement',
  'Tainted Aether',
  "Teferi's Moat",
  'Surgical Extraction',
  'Eradicate',
  'Haunting Echoes',
  'Mind Funeral',
  'Time Stretch',
  'Caltrops',
  'Crawlspace',
  'Ensnaring Bridge',
  'Grindstone',
  'Quietus Spike',
  'Trepanation Blade',
  'Moat',
];

const BANNED_LOWER = new Set(HORDE_BAN_LIST.map((n) => n.toLowerCase()));

export interface HordeBanWarning {
  seatName: string;
  cardName: string;
}

/** One warning per (seat, banned card) pair found across the given seats'
 *  card names — a seat with no deck loaded yet (`cardNames` empty) is silent,
 *  never an error. */
export function findBannedCards(
  seats: readonly { name: string; cardNames: readonly string[] }[]
): HordeBanWarning[] {
  const warnings: HordeBanWarning[] = [];
  for (const seat of seats) {
    for (const name of seat.cardNames) {
      if (BANNED_LOWER.has(name.toLowerCase()))
        warnings.push({ seatName: seat.name, cardName: name });
    }
  }
  return warnings;
}
