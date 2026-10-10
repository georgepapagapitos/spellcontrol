# Golden-set spec: what each "why it fits your commander" pill claims

This is the definition `why-pills.golden.fixture.json` was rated against and
the contract `whyCardMatches` (whyCardMatches.ts) is held to by
`whyCardMatches.golden.test.ts`. Every item was rated blind by two
independent raters (96% agreement); the rulings at the end settled the 72
disagreements. To change what a pill means, change this file first, re-rate the
affected items, then change the code.

Baseline (2026-10-10, before the rewrite): 46% of pills on the EDHREC top 500
were correct, and 64% on the held-out sample. After: 99.5% and 95%.

Ruling (product owner, 2026-10-09): a pill claims a **real interaction**. The card does
something the commander's plan uses or pays off. Merely _being_ a card type
(an artifact, an instant, a land) is never enough on its own.

Each item is one card × one check. Answer TRUE when the card, read from its
Oracle text and type line, satisfies the YES rule for that check under normal
play (you control the card, you cast it for its intended purpose). Answer FALSE
otherwise. Judge the card, not any keyword in it: who benefits, which direction
the effect goes, and whose permanents it touches all matter.

General rules for every check:

- "You/your" effects count. An effect that only helps opponents does not.
- Self-referential costs don't count as the theme: "Sacrifice this land: search"
  is not a sacrifice outlet; "this artifact deals 1 damage to you" is not
  artifact synergy.
- A symmetric effect counts only if the YES rule says so.
- Reminder text is not rules text. Ignore it.
- Modal / multi-face cards: TRUE if any mode or face satisfies the rule.
- One-shot effects count unless the rule says "repeatable".

## etb — "Re-triggers ETB effects"

YES: exiles/bounces and returns YOUR permanents (blink, flicker), or makes ETB
triggers trigger again / an additional time (Panharmonicon effects), or copies
permanents entering.
NO: a creature that merely has its own ETB ability; removal that exiles an
opponent's permanent; "this land enters tapped".

## attack-trigger — "Evasion or attack payoff"

YES: grants evasion or unblockability to a creature you control (flying,
trample, menace, shadow, "can't be blocked", "can't be blocked except by"),
gives additional combat phases, removes potential blockers for your attack
(e.g. "creatures can't block this turn"), or carries its own attack trigger
that pays off (whenever this creature / equipped creature / you attack). An
attack-trigger commander like Isshin multiplies exactly those.
NO: a creature that has evasion itself and no attack trigger; tokens that come
with flying; attack triggers that are only a drawback; effects that stop
opponents attacking.

## sacrifice — "Sac fodder, outlet or payoff"

YES: creates tokens under YOUR control (fodder, including Treasure/Clue/Food);
lets you sacrifice OTHER permanents as a cost or effect (outlet); pays off your
permanents being sacrificed or dying.
NO: only sacrifices itself (fetchlands, Mind Stone, Chromatic Star); gives the
token to an opponent ("its controller creates"); makes opponents sacrifice
(edicts) unless you also benefit from your own sacrifices.

## dies-trigger — "Triggers / feeds your death payoff"

YES: a sac outlet for creatures; creates creature tokens for you; payoff when
your creatures die; mass effects you'd run to kill your own creatures for value.
NO: self-sacrifice only (fetchlands, self-sac artifacts); opponent tokens; plain
removal of opponents' creatures.

## plus-one-counters — "Adds or pays off +1/+1 counters"

YES: puts +1/+1 counters on your permanents; proliferate; doubles/increases
counters; pays off +1/+1 counters.
NO: removes counters as hate; only -1/-1 counters.

## minus-counters — "Adds or pays off -1/-1 counters"

YES: puts -1/-1 counters; wither, infect; proliferate; pays off -1/-1 counters.
NO: unrelated counters.

## proliferate — "Places or scales counters"

YES: puts counters of any kind where proliferating them matters (+1/+1, -1/-1,
loyalty, poison, charge/lore/etc. used as a resource), proliferate, counter
doublers.
NO: counterspells; the word "counter" as a verb; counters only mentioned in
reminder text.

## counters-generic — "Cares about counters"

Same YES/NO rule as proliferate.

## leaves-battlefield — "Bounces/blinks to retrigger leave effects"

YES: blinks/flickers or bounces YOUR permanents so they leave and come back;
sac outlets for your other permanents.
NO: self-sacrifice only; removal that bounces/exiles opponents' permanents.

## tokens — "Makes or pumps tokens"

YES: creates tokens under your control; doubles tokens; anthem that pumps your
creatures (tokens included).
NO: gives an opponent the token; a token only as reminder text.

## lifegain — "Gains life / lifegain payoff"

YES: you gain life; grants lifelink to your creatures; pays off life gain.
NO: an opponent gains life (Swords to Plowshares).

## lifeloss-drain — "Drains opponents"

YES: makes opponents lose life (each opponent / target opponent / target player
pointed at an opponent) as a drain effect.
NO: you losing life as a cost or drawback; damage-only burn (unless it says
"loses life"); symmetric loss where you're the one paying.

## draw — "Refills your hand"

YES: you draw one or more cards (cantrips count, repeatable or one-shot).
NO: an opponent draws; "draw" only in a restriction ("can't draw").

## wheel-discard — "Wheel / discard synergy"

YES: wheels (each player discards and draws); a discard outlet for you (loot,
rummage, discard as a cost); pays off discarding (madness, "whenever you
discard").
NO: making only opponents discard (Thoughtseize); "discard" only in an
alternative cost that no deck builds around (treat discard-as-cost outlets as
YES only when repeatable or card-neutral like loot/rummage).

## tutor — "Tutors for your key pieces"

YES: searches your library for a NONLAND card (any card, a creature, an
artifact, etc.).
NO: searches only for lands (Cultivate, Evolving Wilds, fetchlands).

## mill — "Fills graveyards"

YES: puts cards from a library into a graveyard (mill, surveil, "put the top N
into your graveyard", entomb).
NO: exiles graveyards (hate); returns cards from graveyards (recursion);
"graveyard" only as the place a card goes when it dies.

## graveyard-recursion — "Recurs cards from the graveyard"

YES: returns cards from your graveyard to hand/battlefield, or lets you cast or
activate cards from your graveyard (flashback, escape, unearth, etc.).
NO: graveyard hate; cards that only go to the graveyard.

## spellcast — "Spellslinger payoff or enabler"

YES: triggers on or pays off casting instants/sorceries or noncreature spells;
copies spells; reduces instant/sorcery costs; storm/magecraft/prowess-style.
NO: merely being an instant or sorcery; tutors/recursion that mention "instant
or sorcery card" without a cast payoff; counterspells.

## artifact-matters — "Cares about artifacts"

YES: creates artifacts (Treasure, Clue, Food, Thopter tokens…); pays off or
counts artifacts; reduces artifact costs; recurs/tutors artifacts.
NO: merely being an artifact; destroys artifacts; "this artifact" self-reference.

## enchantment-matters — "Cares about enchantments"

YES: creates enchantments/enchantment tokens; constellation/enchantress payoffs;
counts enchantments; recurs/tutors enchantments.
NO: merely being an enchantment or Aura; removal of enchantments; counters an
enchantment spell.

## landfall — "Triggers / enables landfall"

YES: puts lands onto the battlefield beyond your normal drop (ramp spells that
fetch to the battlefield, fetchlands, extra land drops); landfall payoffs; land
recursion to the battlefield or to hand for replay.
NO: lands that just tap for mana; bounce/removal of opponents' lands; "nonland".

## extra-combat — "Extra combat / attack payoff"

YES: additional combat phases; payoffs when your creatures attack.
NO: triggers on opponents attacking; restrictions on attacking.

## extra-turn — "Extra-turn synergy"

YES: gives you an extra turn, or pays off extra turns.
NO: skipping turns.

## untap-engine — "Untap / combo enabler"

YES: untaps your permanents (creatures, lands, artifacts), including itself if
repeatable value.
NO: "doesn't untap during your untap step"; tapping opponents' things.

## monarch — "Monarch synergy"

YES: makes you the monarch or pays off the monarch.

## group-hug — "Group / political synergy"

YES: gives every player (or chosen opponents) a resource: cards, mana, life,
lands; or deal-making/vote effects.
NO: symmetric punishment (each player sacrifices, loses life, discards
without drawing); board wipes.

## ramp — "Mana acceleration / payoff"

YES: produces mana beyond your land drop (mana rocks, mana dorks, land ramp onto
the battlefield, rituals, mana doublers), or reduces the cost of your spells in
general.
NO: a land that taps for one mana (that IS your land drop); lands that fetch one
land (net zero); a spell that only reduces its own cost.

## voltron — "Suits up / protects your commander"

YES: Equipment or Aura that buffs or grants abilities to a creature you control;
effects that grant a creature you control (or your creatures) protection
(hexproof, shroud, indestructible, protection from, phasing) or evasion.
Any Equipment is YES (it attaches to your creature), whatever else it does.
NO: Auras that enchant lands, players, or creature cards in graveyards; Auras
that hinder the enchanted creature (removal Auras); protection that only covers
the card itself (a creature giving itself indestructible) or only you as a
player ("you gain protection from everything").

## Adjudication rulings (added after the first rating pass, applied to disagreements)

R1. Bounce lands (Simic Growth Chamber, Ghost Town and kin): FALSE for etb and
leaves-battlefield (no ETB worth repeating is re-triggered). For landfall
they stay TRUE, per the landfall rule's "to hand for replay".
R2. Bounce or blink that can target ANY permanent (Snap, Jace's -1, Otawara,
Admonition Angel): FALSE for etb and leaves-battlefield; it's removal or
tempo. TRUE only when restricted to your permanents or when it explicitly
returns the card (Ephemerate, Cloudshift, Teleportation Circle).
R3. A card's trigger on its OWN attack (Etali, Sun Titan, Goldspan Dragon,
Sword of the Animist): TRUE for extra-combat and for attack-trigger.
Amended 2026-10-10: first ruled FALSE for attack-trigger, which contradicted
the Coach's Isshin plan-card guard (incidentalRole, coach-protections);
ten items were re-decided under the amendment.
R4. A creature with value on its OWN death (Solemn Simulacrum, Fang): TRUE for
dies-trigger and sacrifice (good fodder). Self-sacrifice as the only
sacrifice (fetchlands, Mind Stone) stays FALSE.
R5. Cost reducers for a class of your spells (Medallions, Foundry Inspector,
Urza's Incubator): TRUE for ramp. For spellcast only when instants/sorceries
or noncreature spells are the class.
R6. Lands that tap for two or more (Ancient Tomb, Temple of the False God):
TRUE for ramp. Filter lands: FALSE.
R7. Keyword actions are judged by their rules meaning even though their
explanation is reminder text: learn rummages, the monarch draws, connive
loots, explore puts a land in hand or a counter.
R8. Payoffs for opponents discarding (Tergrid, Raiders' Wake): TRUE for
wheel-discard. Spells that only make opponents discard: FALSE.
R9. Land tutors that put the land into hand only: FALSE for landfall.
R10. "Target player"/"chosen player" effects you can point at yourself in
normal play (Timesifter, Selvala, Denethor's monarch): TRUE.
R11. Untapping a creature as part of stealing it (Threaten, Flash Conscription)
or untapping an attacking creature (Maze of Ith): FALSE for untap-engine.
R12. Voltron protection includes ward. Damage prevention, regeneration, blink
and recursion are not "suits up / protects": FALSE.
R13. Symmetric mass reanimation or wipes (Living Death): FALSE for group-hug.
R14. A creature with lifelink of its own: TRUE for lifegain.
R15. Conditional grants on Auras/Equipment stay TRUE for voltron; anthems that
rarely apply (Finale of Devastation's X >= 10) are FALSE for tokens.
R16. Counters used only as markers with no effect from more of them (memory,
void, luck) or as a drawback countdown (Orcish Mine): FALSE for
proliferate/counters-generic. Resource counters (oil, charge, storage,
lore, bore) on your permanents: TRUE.
R18. Predefined tokens are judged by their abilities even though those are
reminder text: a Food maker gains life, a Treasure maker ramps, a Clue
maker draws.
R17. Sacrificing an artifact as one option among card types (Braids): FALSE for
artifact-matters; artifact specifically as a cost: TRUE.
