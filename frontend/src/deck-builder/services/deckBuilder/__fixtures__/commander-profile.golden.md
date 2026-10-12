# Golden-set spec: what each commander keyword claims

This is the definition `commander-profile.golden.fixture.json` was rated against
and the contract `buildCommanderProfile` (commanderProfile.ts) is held to by
`commanderProfile.golden.test.ts`. It is the commander-side twin of
`why-pills.golden.md`, which defines the CARD side. To change what a keyword
means, change this file first, re-rate the affected items, then change the code.

Ruling carried over from the card side (product owner, 2026-10-09): a keyword
claims a **real interaction**. A passing mention of a word is not enough.

Each item is one commander. Tag it with EVERY keyword below that is true of it.
A keyword is TRUE when the commander's Oracle text (all faces) and type line
make a deck builder go looking for cards that feed or pay off that plan: the
keyword is something this commander **wants, does, or rewards**, not just a word
it contains. Judge the commander's ability, not its vocabulary.

General rules:

- Read all faces. TRUE if any face satisfies the rule.
- Reminder text (in parentheses) is not rules text. Ignore it.
- "You/your" effects count. An effect that only helps or only hurts opponents
  does not count as the commander's plan unless the keyword says so.
- The commander referring to itself ("sacrifice ~", "when ~ enters") counts only
  where the keyword says so.
- A drawback or restriction (an upkeep cost, "can't attack") is not a plan.
- One-shot abilities count unless the rule says "repeatable".
- Use only the text you were given, not memory of the card.

## etb — "Enters-the-battlefield trigger"

YES: the commander has its own "when ~ enters" ability that does something, or it
doubles or re-triggers enters-the-battlefield abilities, or it blinks/flickers
permanents so they enter again.
NO: "enters tapped" or "enters with counters" replacement text only; the word
"enters" appearing only as a condition on OTHER permanents (a creature or land
entering is creature-etb or landfall instead).

## creature-etb — "Creature-enters trigger"

YES: triggers on or rewards creatures entering the battlefield ("whenever
another creature enters", "whenever a nontoken creature you control enters", "one
or more creatures enter"), including a tribe's creatures entering.
NO: only its own enters trigger; lands entering; a creature entering only inside
a "dies ... enters" sentence about something else.

## attack-trigger — "Attack trigger"

YES: attacking with your creatures pays off for you: "whenever ~ attacks",
"whenever you attack", "whenever a creature you control attacks", battle cry-like
text, or text that doubles attack triggers.
NO: triggers on opponents' creatures attacking (pillowfort/deterrent); "can't
attack" restrictions; "attacks each combat if able" drawbacks.

## sacrifice — "Sacrifice payoff"

YES: the commander sacrifices OTHER permanents as a cost or effect (an outlet),
or triggers when permanents are sacrificed, or creates things to be sacrificed.
NO: it only sacrifices itself; it makes only OPPONENTS sacrifice (edicts); a
sacrifice that is an upkeep drawback ("sacrifice a creature unless you pay").

## dies-trigger — "Death trigger"

YES: the commander has a "when ~ dies" ability of its own, or triggers when other
creatures die (yours, opponents', or any), or pays off creatures dying.
NO: "dies" used only as a description of a thing the commander causes through
plain removal; "if a creature would die" replacement text.

## plus-one-counters — "+1/+1 counter synergy"

YES: puts, moves, doubles, removes (as a cost) or counts +1/+1 counters in an
ability the commander uses, or triggers on counters being placed.
NO: only "enters with N +1/+1 counters" on itself and nothing else about
counters; -1/-1 counters; the counterspell sense of "counter".

## minus-counters — "-1/-1 counter synergy"

YES: puts, moves, removes or counts -1/-1 counters in an ability the commander uses.
NO: infect or wither with no -1/-1 counter text; +1/+1 counters only.

## proliferate — "Proliferate"

YES: the commander proliferates, or doubles or multiplies counters placed on
permanents or players.
NO: counterspells; mentioning counters without proliferating or multiplying them.

## counters-generic — "Counter synergy"

YES: puts, moves, removes or counts counters of any kind (+1/+1, charge, loyalty,
poison, age...) in an ability the commander uses.
NO: counterspells ("counter target spell"); only "enters with N counters" on itself.

## leaves-battlefield — "Leaves-the-battlefield trigger"

YES: a trigger on permanents or creatures leaving the battlefield, including its
own ("when ~ leaves the battlefield").
NO: "until ~ leaves the battlefield" duration text (a removal effect, not a
trigger); creatures dying (dies-trigger).

## tokens — "Token maker"

YES: the commander creates creature tokens (including token copies), or doubles
or rewards tokens.
NO: it creates only non-creature tokens (Treasure, Clue, Food, Blood) with no
creature tokens; the token goes only to an opponent; tokens in reminder text.

## lifegain — "Lifegain synergy"

YES: the commander gains you life as an ability (not just the lifelink keyword),
or triggers when you gain life.
NO: only an opponent gains life; only lifelink with no other life text.

## lifeloss-drain — "Drain / life loss"

YES: it makes opponents lose life (drain, "each opponent loses N life"), or
triggers when an opponent loses life.
NO: only YOU lose life (a cost or drawback); "loses the game"; damage with no
life loss wording.

## draw — "Card draw engine"

YES: you draw cards through an ability of the commander (repeatable or one-shot),
or it rewards cards being drawn (by anyone).
NO: only opponents draw as a cost to them; "draw" only in a restriction.

## wheel-discard — "Wheel / discard"

YES: each player discards their hand and draws, or you discard your hand, or it
triggers when players discard or draw extra.
NO: discarding as a cost for one ability with no wheel or discard payoff.

## tutor — "Tutor"

YES: searches your library for a card that is not just a basic land: a nonland
card, a card of any type, or a card by criteria.
NO: searches only for lands.

## mill — "Mill / self-mill"

YES: puts cards from a library into a graveyard (mill, "put the top N cards of
your library into your graveyard"), or pays off cards being milled.
NO: graveyard hate; returning cards from the graveyard (graveyard-recursion).

## graveyard-recursion — "Graveyard recursion"

YES: returns cards from a graveyard to hand or the battlefield, or lets you cast
cards from your graveyard.
NO: graveyard hate; exiling cards from your graveyard only as a cost.

## spellcast — "Spellcast trigger"

YES: triggers on casting or copying instants, sorceries, noncreature spells or
spells in general; magecraft; prowess; spell copying.
NO: only creature, artifact or enchantment spell casts; merely being cast.

## artifact-matters — "Artifact synergy"

YES: creates, recurs, counts, tutors or pays off artifacts (Treasure, Clue and
Food tokens count), or cares about equipment.
NO: only destroys or ignores artifacts; the commander merely being an artifact
creature.

## enchantment-matters — "Enchantment synergy"

YES: creates, recurs, counts, tutors or pays off enchantments (Auras and Sagas
count), constellation, enchantress triggers.
NO: only removes enchantments; the commander merely being an enchantment creature.

## landfall — "Landfall"

YES: triggers when lands enter, or lets you play additional lands, or repeatedly
puts lands onto the battlefield.
NO: only taps lands for mana; counts lands without triggering on them; a single
land search (ramp).

## extra-combat — "Extra combat"

YES: grants additional combat phases.
NO: any other mention of combat.

## extra-turn — "Extra turns"

YES: takes extra turns or pays off extra turns.
NO: skipping turns.

## untap-engine — "Untap engine"

YES: untaps permanents other than itself (lands, creatures, artifacts), or
untaps all of something.
NO: untaps only itself (pseudo-vigilance); "doesn't untap" restrictions.

## monarch — "Monarch"

YES: makes you the monarch or pays off the monarch (taking it, keeping it).
NO: no monarch text.

## group-hug — "Group effects"

YES: gives every player a benefit, including opponents (each player draws cards,
gains life, may put a land onto the battlefield), a plan that turns shared
resources to your favor.
NO: symmetric drawbacks (each player sacrifices, loses life, discards); wheels
(wheel-discard); benefits only for you.

## ramp — "Mana / cost engine"

YES: adds mana (any mana ability beyond a plain land tap), doubles mana, reduces
the cost of spells you cast, or repeatedly puts lands or Treasure onto the
battlefield.
NO: cost increases ("spells cost {1} more") on opponents; paying mana as a cost
for an ability.

## voltron — "Voltron threat"

YES: a creature commander built to be the one big attacker: stacked
evasion/protection keywords, text that rewards equipment, auras or counters on
itself, double strike, or commander-damage focus.
NO: a commander whose value comes from other creatures, tokens, triggers or
spells and not from connecting itself; an unremarkable body.

## tribal — "Tribal"

YES: the commander's own text rewards or refers to ONE OF ITS OWN creature types
(lords: "other Elves you control", "whenever another Zombie enters"), or is a
changeling/"chosen type" typal lord.
NO: no creature-type text; text naming only a different type than the
commander's own; the type line alone (a Human with no Human text).

## Adjudication rulings (applied to the 118 of 20,100 pairs the raters split on)

Two blind raters tagged all 670 commanders against the definitions above
(kappa 0.75 to 1.00 per keyword, 99.4% pair agreement). Each split was decided
by these rulings.

R1. Reminder text is not rules text, so a keyword whose only evidence is in
parentheses (fabricate, mobilize, connive, a Treasure's "sacrifice this token")
does not count. This is the one place the two raters read the rule differently.
R2. A temporary token the commander makes and sacrifices itself (Kiki-Jiki,
Saheeli, Terra, Feldon) counts as "creates things to be sacrificed" for
sacrifice.
R3. Triggers that need an OPPONENT to cast (Arasta, Nezahal, Kambal) are not
spellcast: no spell of yours is rewarded. A trigger on "a player" casting (Mai,
The Council of Four) is. Color, historic and "you don't own" spell triggers count
as spells in general. Free casts and cost reductions for instants and sorceries
(Zaffai, Codie, The Scarlet Witch) count.
R4. Auras count as enchantments and Equipment as artifacts. A noncreature artifact
token (Treasure, Clue, Food, Blood) counts for artifact-matters; an artifact
creature token (Mite, Soldier) does not. "Modified" is reminder text.
R5. Damage to opponents is not drain unless the text says life loss (Syr Konrad,
Aurelia). "Opponents who lost life" and "they lose N life" are drain.
R6. creature-etb covers a tribe entering and "enters with additional counters"
(Arwen, Giada, Tayam). It does not cover "another permanent" (Kodama of the East
Tree, Amareth) or tokens that are not creature tokens.
R7. etb includes "Whenever ~ or another creature enters" (it enters too), and
blink or trigger doubling. A land entering is landfall, not etb.
R8. A commander that returns ITSELF from the graveyard or to hand when it dies
(Ojer, The Scorpion God) is not graveyard-recursion. One that returns ANOTHER card
(Liesa, Koll, Vraska) is.
R9. Putting land cards onto the battlefield on a repeatable trigger (Kodama of
the West Tree, The Earth King, Ojer Kaslem, Nine-Fingers Keene) is landfall and
ramp. A one-shot mass return (Lumra) is not landfall. A cost increase or a
self-only cost reduction ("This spell costs {1} less") is not ramp.
R10. "Cards put into your graveyard" payoffs (The Gitrog Monster, Slogurk, Yuma)
and surveil are not mill. "Put a card from the top of your library into your
graveyard" (Scion of the Ur-Dragon, Kellan) is.
R11. Voltron: two or more evasion/protection keywords with no engine, or text
that buffs the commander itself (equipment, auras, double strike, a "commander you
control" clause). A lone flyer or a big vanilla body is not.
R12. Tribal: a text reference to one of the commander's own types, including
tokens of that type (Elenda, Namora, Great Goblin). Changeling and "chosen type"
lords count.
R13. group-hug: the commander hands another player a resource on purpose (Breena,
Tataru Taru, Gonti, Belbe). Loot and wheel symmetry (Cait, Malcolm) is not
group-hug and not wheel-discard.
R14. Attack-trigger needs the attack declaration: combat damage and boast payoffs
(Drana, Varragoth) are not attack triggers; Annihilator is.
