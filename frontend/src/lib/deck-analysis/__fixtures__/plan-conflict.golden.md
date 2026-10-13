# Plan conflict: when a board wipe fights the deck it sits in

Used to label (deck, board wipe) pairs for the Deck checks / Coach "plan conflict" rule
(E356 slice E). Raters see a decklist with oracle text and one wipe at a time. They never
see any rule output, tagger tag or archetype label.

This replaces the 2026-10-10 plan-conflict precision set (30 decks, 77 wipes), which was
built for the owner to rate by hand and was lost with its session scratchpad. The question
here is the same one: "does this wipe fight what this deck is trying to do?"

## The question

For each listed card, answer with one label:

- `NOTWIPE` The card is not a board wipe at all (a tag mistake: a single-target removal
  spell, a one-creature effect, a damage spell that only hits chosen targets). The item
  leaves the set.
- `CONFLICT` Casting this card, as the deck's pilot would on a normal board, wrecks the
  deck's own plan and the list has no good way to dodge it or rebuild afterwards.
- `FINE` Anything else: the wipe is aimed away from the deck's plan, spares the
  caster's side, or the list has an answer.

Judge the card as printed, in this list, in a 4-player Commander pod.

## Step 1: what does the wipe take from the caster's own side?

- A wipe is **one-sided** if the printed text spares the caster's permanents (destroys,
  exiles or damages only "creatures you don't control" / "your opponents control").
  One-sided wipes are `FINE`, always.
- A wipe is **symmetric** if it takes the caster's permanents of the hit type too.
  "Reach" is the permanent types it hits: creatures only, or also artifacts, enchantments,
  planeswalkers, lands ("all permanents").
- A wipe that hits only a narrow slice (only tapped creatures, only creatures with power 4
  or greater, only nonland permanents of one named color, only a mode the pilot can choose
  not to use) counts as its slice. Ask: does the slice contain the deck's plan?
- A wipe the pilot chooses the size of (X, "up to", modal where one mode is harmless to
  them) is treated at the mode the pilot would actually pick.

## Step 2: does the deck's plan lean on what the wipe takes?

The plan **leans on** a permanent type when losing a full board of that type sets the
deck back by several turns of development, or removes the deck's win route. Typical cases:

- Creature wipe: the deck's win route or engine is creatures. A go-wide token or
  creature-count deck, a creature-combat deck (a pile of creatures with an attack-trigger
  or combat-damage commander), a voltron deck whose pieces are creatures that carry
  equipment or auras (equipment stays, but the creature to carry it and the investment in
  the creature are gone), an aristocrats or tribal deck whose engine pieces are creatures.
  Roughly, 40 percent or more of the nonland cards are creatures or token makers, OR the
  commander itself is a creature-based engine whose payoff needs other creatures.
- Artifact / enchantment / planeswalker / land reach: the deck leans on that type in the
  same way (an enchantress deck's own enchantments, an artifact deck's rocks and
  artifact payoffs, a landfall or lands-matter deck facing land destruction).
- Does NOT lean: control and spell-based decks (mostly instants, sorceries, planeswalkers,
  card advantage engines and few creatures), combo decks that win from a graveyard, hand or
  library with no board, and decks whose creatures are incidental utility bodies.

If the plan does not lean on the hit type, the label is `FINE`.

## Step 3: can the deck dodge or rebuild?

Even a deck that leans on the board is `FINE` if the list shows at least one of:

- **Dodge.** The deck can save its board from this wipe: mass indestructible/regenerate
  or protection effects for a destroy-based wipe (Heroic Intervention, Teferi's Protection,
  Boros Charm), mass blink / flicker / phasing / bounce in response (Eerie Interlude,
  Ghostly Flicker), or the commander's own protection. One or two copies in the list
  count only if the deck's tutors, draw or the commander make them findable; a lone
  card in a 100-card list is not a dodge.
- **Rebuild.** The deck can restore a board within about two turns: mass recursion
  (Eternal Witness-style one-offs do NOT count; effects returning several creatures do),
  cheap repeatable token or creature production that works from an empty board (an
  engine that does not need existing creatures), many haste or non-creature threats, or a
  commander that is itself the engine and is recast cheaply.
- **Built around the wipe.** The list is a wipe-then-rebuild or wipe-then-profit shell: it
  has several payoffs that need an empty or reset board (mass reanimation, punisher and
  symmetrical-effect cards that favor the pilot), or its main creatures survive the wipe
  type (indestructible or high toughness against a damage or -X/-X wipe they clear).

Only count answers that are actually in the list, not ones the pilot could add.

## Decision

`CONFLICT` = symmetric (Step 1) AND the plan leans on the type it hits (Step 2) AND
no dodge or rebuild is present (Step 3). Everything else that is a real board wipe is `FINE`.

Write a one-line note naming the deciding fact (for example "tokens deck, 40 creatures,
no recursion" or "has Eerie Interlude + Ghostly Flicker").

## Rulings (added during adjudication)

Raters A and B agreed on 94 of 98 items (kappa 0.69, FINE/FINE 89, CONFLICT/CONFLICT 5, FINE vs CONFLICT 4). The four splits were settled with these rulings.

- R1. A single copy of a dodge or rebuild card does not count, whichever of the two it is,
  unless the commander or a tutor in the list can fetch it. (The "lone card" sentence in
  Step 3 applies to rebuilds too.) D21 Game Over, Vanquish the Horde and Blasphemous Act:
  one Continue? and one Vigor in a go-wide creature deck. Truth: CONFLICT.
- R2. A commander that restarts the plan alone, with no other creature needed, counts as a
  rebuild even in a creature deck. D14 Wrath of God: Marath, Will of the Wild is recast for
  any X and makes its own tokens. Truth: FINE.

Everything else is the agreed rating.

### Held-out set (rated after the rule was frozen)

The first set (D01 to D30, seed 20261013) was used to write the rule, so it is in-sample.
The second set (H01 to H30, seed 31415926, 90 items) was drawn disjoint from it and rated
by two fresh raters with this definition, after the rule was frozen. Agreement: 83 of 90,
kappa 0.60 (FINE/FINE 77, CONFLICT/CONFLICT 6, FINE vs CONFLICT 7). The seven splits were
adjudicated against the definition (these rulings were written after seeing the split):

- R3. The "roughly 40 percent creatures or token makers" lean line is applied literally.
  H04 (Ixhel poison, 22 of 61 nonland cards are creatures, about 39 percent with token
  makers): Fumigate, Culling Ritual and Phyrexian Rebirth are FINE.
- R4. H20 (Abaddon, 29 of 61 are creatures, 13 of 29 have toughness above 3): the deck leans on
  creatures and its two wipe payoffs are not "several". Decree of Pain, Blasphemous Act and
  Blight Grenade (-3/-3 kills 16 of 29) are CONFLICT.
- R5. A wipe whose size the pilot sets (Let the Galaxy Burn, X plus 2 damage) is read at the
  size that spares the pilot's best creatures. FINE.

## Rule v1 result (not shipped)

Rule v1 (symmetric wipe, creature share at least 45 percent or artifact/enchantment share at
least 40 percent, no narrow slice, no pilot-sized or optional wipe, creatures not outgrowing a
fixed damage wipe, and no answer: two mass-dodge or mass-recursion cards, or a commander that
is not a creature or that makes tokens) scored:

- In-sample (98 items, 8 CONFLICT): precision 8 of 8 (Wilson 95 percent 0.68 to 1.00), recall 8 of 8.
- Held-out (90 items, 9 CONFLICT): precision 4 of 8 = 0.50 (Wilson 0.22 to 0.78), recall 4 of 9 = 0.44
  (Wilson 0.19 to 0.73).

The gate was precision of at least 0.8, so the rule was not shipped. The misses:

- False positives: Languish and Merciless Eviction in H02 (the -4/-4 is outgrown by +1/+1
  counters; the second is modal), Winds of Rath in H23 (spares enchanted creatures, the deck's
  threats), Let the Galaxy Burn in H20 (R5).
- False negatives, all from the answer test being too loose: H01 Decree of Pain, Necromantic
  Selection and Nevinyrral's Disk (Inalla's token engine needs other Wizards), H17 Earthquake
  and Supreme Verdict (Bastion Protector and Frontline Medic read as mass protection, Eowyn's
  token trigger needs another Human).

A v2 would need a stricter answer test (unconditional mass protection only; a commander engine
that works with no other creature) and counters-aware toughness and "unless enchanted" slices.
Its precision must be measured on a third, unseen draw: both sets here have now been looked at.
The v1 source is in `.claude/tools/plan-conflict-harness/` (machine-local).
