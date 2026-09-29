/**
 * Graded, role-conditioned substitute judgments: "for ROLE, how well does B
 * stand in for A?" Hand-verified against oracle text; never derived from the
 * tagger corpus (a similarity tuned on tagger tags and then graded against
 * them would be circular). A later slice can train a substitute ranker on
 * these rows; scripts/card-facts-eval.mjs scores the current tag similarity
 * against them (recall@k and graded nDCG, holding each card out in turn).
 *
 * grade  3 direct   interchangeable for the role (same effect, scope, speed)
 *        2 partial  same role, a real difference in scope, cost or condition
 *        1 weak     the role overlaps only in part
 *        0 none     not a substitute for this role
 *
 * `role` is a FactRole or a function key from functions.ts. Rows are
 * symmetric: a grade holds in both directions.
 */
export interface SubstituteRow {
  a: string;
  b: string;
  role: string;
  grade: 0 | 1 | 2 | 3;
}

export const SUBSTITUTES: SubstituteRow[] = [
  // Grave Pact effects: "whenever a creature you control dies, each other player sacrifices".
  { a: 'Grave Pact', b: 'Dictate of Erebos', role: 'grave-pact', grade: 3 },
  { a: 'Grave Pact', b: 'Butcher of Malakir', role: 'grave-pact', grade: 3 },
  { a: 'Dictate of Erebos', b: 'Butcher of Malakir', role: 'grave-pact', grade: 3 },
  { a: 'Grave Pact', b: 'Savra, Queen of the Golgari', role: 'grave-pact', grade: 2 },
  { a: 'Dictate of Erebos', b: 'Savra, Queen of the Golgari', role: 'grave-pact', grade: 2 },
  { a: 'Grave Pact', b: "Liliana's Triumph", role: 'grave-pact', grade: 1 },
  // Cheap instant creature removal, and the wider "answer a permanent".
  { a: 'Swords to Plowshares', b: 'Path to Exile', role: 'removal', grade: 3 },
  { a: 'Swords to Plowshares', b: 'Infernal Grasp', role: 'removal', grade: 3 },
  { a: 'Path to Exile', b: 'Go for the Throat', role: 'removal', grade: 3 },
  { a: 'Infernal Grasp', b: 'Doom Blade', role: 'removal', grade: 3 },
  { a: 'Go for the Throat', b: 'Doom Blade', role: 'removal', grade: 3 },
  { a: 'Swords to Plowshares', b: 'Anguished Unmaking', role: 'removal', grade: 2 },
  { a: 'Path to Exile', b: 'Vindicate', role: 'removal', grade: 2 },
  { a: 'Doom Blade', b: 'Generous Gift', role: 'removal', grade: 2 },
  { a: 'Anguished Unmaking', b: 'Vindicate', role: 'removal', grade: 3 },
  { a: 'Vindicate', b: 'Generous Gift', role: 'removal', grade: 3 },
  // Taxing draw engines.
  { a: 'Rhystic Study', b: 'Mystic Remora', role: 'cardDraw', grade: 3 },
  { a: 'Rhystic Study', b: 'Esper Sentinel', role: 'cardDraw', grade: 3 },
  { a: 'Mystic Remora', b: 'Esper Sentinel', role: 'cardDraw', grade: 3 },
  { a: 'Rhystic Study', b: 'Consecrated Sphinx', role: 'cardDraw', grade: 2 },
  { a: 'Rhystic Study', b: 'Smothering Tithe', role: 'cardDraw', grade: 1 },
  // Counterspells.
  { a: 'Counterspell', b: 'Mana Leak', role: 'counterspell', grade: 3 },
  { a: 'Counterspell', b: 'Arcane Denial', role: 'counterspell', grade: 3 },
  { a: 'Counterspell', b: 'Force of Will', role: 'counterspell', grade: 3 },
  { a: 'Mana Leak', b: 'Arcane Denial', role: 'counterspell', grade: 3 },
  { a: 'Negate', b: "Dovin's Veto", role: 'counterspell', grade: 3 },
  { a: 'Negate', b: 'Fierce Guardianship', role: 'counterspell', grade: 3 },
  { a: 'Counterspell', b: 'Negate', role: 'counterspell', grade: 2 },
  { a: 'Counterspell', b: 'Swan Song', role: 'counterspell', grade: 2 },
  { a: 'Negate', b: 'Swan Song', role: 'counterspell', grade: 2 },
  // Land ramp spells.
  { a: 'Cultivate', b: "Kodama's Reach", role: 'ramp', grade: 3 },
  { a: 'Rampant Growth', b: "Nature's Lore", role: 'ramp', grade: 3 },
  { a: 'Rampant Growth', b: 'Farseek', role: 'ramp', grade: 3 },
  { a: "Nature's Lore", b: 'Three Visits', role: 'ramp', grade: 3 },
  { a: 'Skyshroud Claim', b: 'Explosive Vegetation', role: 'ramp', grade: 3 },
  { a: 'Cultivate', b: 'Explosive Vegetation', role: 'ramp', grade: 2 },
  { a: 'Rampant Growth', b: 'Cultivate', role: 'ramp', grade: 2 },
  // Mana rocks.
  { a: 'Arcane Signet', b: "Commander's Sphere", role: 'ramp', grade: 3 },
  { a: 'Arcane Signet', b: 'Fellwar Stone', role: 'ramp', grade: 3 },
  { a: 'Arcane Signet', b: 'Talisman of Dominance', role: 'ramp', grade: 3 },
  { a: 'Mind Stone', b: 'Coldsteel Heart', role: 'ramp', grade: 3 },
  { a: 'Mind Stone', b: 'Talisman of Dominance', role: 'ramp', grade: 3 },
  { a: 'Sol Ring', b: 'Mind Stone', role: 'ramp', grade: 2 },
  { a: 'Sol Ring', b: 'Arcane Signet', role: 'ramp', grade: 2 },
  // Board wipes.
  { a: 'Wrath of God', b: 'Damnation', role: 'boardwipe', grade: 3 },
  { a: 'Wrath of God', b: 'Day of Judgment', role: 'boardwipe', grade: 3 },
  { a: 'Damnation', b: 'Day of Judgment', role: 'boardwipe', grade: 3 },
  { a: 'Wrath of God', b: 'Toxic Deluge', role: 'boardwipe', grade: 3 },
  { a: 'Wrath of God', b: 'Blasphemous Act', role: 'boardwipe', grade: 3 },
  { a: 'Wrath of God', b: 'Austere Command', role: 'boardwipe', grade: 2 },
  { a: 'Wrath of God', b: 'Farewell', role: 'boardwipe', grade: 2 },
  { a: 'Wrath of God', b: 'Hour of Revelation', role: 'boardwipe', grade: 2 },
  { a: 'Farewell', b: 'Austere Command', role: 'boardwipe', grade: 2 },
  // Aristocrat drains.
  { a: 'Blood Artist', b: 'Zulaport Cutthroat', role: 'aristocrat-drain', grade: 3 },
  { a: 'Blood Artist', b: 'Falkenrath Noble', role: 'aristocrat-drain', grade: 3 },
  { a: 'Blood Artist', b: 'Cruel Celebrant', role: 'aristocrat-drain', grade: 3 },
  { a: 'Zulaport Cutthroat', b: 'Cruel Celebrant', role: 'aristocrat-drain', grade: 3 },
  { a: 'Blood Artist', b: 'Bastion of Remembrance', role: 'aristocrat-drain', grade: 3 },
  { a: 'Zulaport Cutthroat', b: 'Vindictive Vampire', role: 'aristocrat-drain', grade: 3 },
  // Recursion to hand.
  { a: 'Eternal Witness', b: 'Regrowth', role: 'recursion', grade: 3 },
  { a: 'Archaeomancer', b: 'Mnemonic Wall', role: 'recursion', grade: 3 },
  { a: 'Gravedigger', b: 'Raise Dead', role: 'recursion', grade: 3 },
  { a: 'Eternal Witness', b: 'Mnemonic Wall', role: 'recursion', grade: 2 },
  { a: 'Eternal Witness', b: 'Gravedigger', role: 'recursion', grade: 2 },
  { a: 'Regrowth', b: 'Raise Dead', role: 'recursion', grade: 2 },
  // Reanimation.
  { a: 'Reanimate', b: 'Animate Dead', role: 'recursion', grade: 3 },
  { a: 'Reanimate', b: 'Necromancy', role: 'recursion', grade: 3 },
  { a: 'Animate Dead', b: 'Necromancy', role: 'recursion', grade: 3 },
  { a: 'Reanimate', b: 'Exhume', role: 'recursion', grade: 2 },
  { a: 'Reanimate', b: 'Victimize', role: 'recursion', grade: 2 },
  // Protection.
  { a: 'Heroic Intervention', b: 'Flawless Maneuver', role: 'protection', grade: 3 },
  { a: 'Lightning Greaves', b: 'Swiftfoot Boots', role: 'protection', grade: 3 },
  { a: 'Heroic Intervention', b: "Teferi's Protection", role: 'protection', grade: 2 },
  { a: 'Heroic Intervention', b: 'Boros Charm', role: 'protection', grade: 2 },
  { a: 'Heroic Intervention', b: 'Lightning Greaves', role: 'protection', grade: 1 },
  // Tutors.
  { a: 'Demonic Tutor', b: 'Diabolic Intent', role: 'tutor', grade: 3 },
  { a: 'Demonic Tutor', b: 'Grim Tutor', role: 'tutor', grade: 3 },
  { a: 'Vampiric Tutor', b: 'Imperial Seal', role: 'tutor', grade: 3 },
  { a: 'Demonic Tutor', b: 'Vampiric Tutor', role: 'tutor', grade: 2 },
  { a: 'Worldly Tutor', b: 'Enlightened Tutor', role: 'tutor', grade: 2 },
  { a: 'Vampiric Tutor', b: 'Worldly Tutor', role: 'tutor', grade: 2 },
  // Plain draw spells.
  { a: 'Harmonize', b: "Night's Whisper", role: 'cardDraw', grade: 3 },
  { a: "Night's Whisper", b: 'Sign in Blood', role: 'cardDraw', grade: 3 },
  { a: 'Harmonize', b: 'Sign in Blood', role: 'cardDraw', grade: 3 },
  // Negatives: same neighbourhood, wrong job.
  { a: 'Grave Pact', b: 'Wrath of God', role: 'removal', grade: 0 },
  { a: 'Sol Ring', b: 'Counterspell', role: 'ramp', grade: 0 },
  { a: 'Rhystic Study', b: 'Regrowth', role: 'cardDraw', grade: 0 },
  { a: 'Blood Artist', b: 'Harmonize', role: 'aristocrat-drain', grade: 0 },
  { a: 'Cultivate', b: 'Demonic Tutor', role: 'ramp', grade: 0 },
];
