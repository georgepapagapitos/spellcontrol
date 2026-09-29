// Can this card (or pair) lead a deck in this format? (E530)
//
// The one answer the generator's entry, the generate page and the invariant
// checker all read, so a commander the page lets through is one the
// generator builds, and one it refuses is refused with the same reason.
// USER RULING 2026-09-29: an illegal commander refuses to build and says why,
// instead of shipping a deck around it (the stress panel built full decks
// for Atraxa in Pauper Commander and for Llanowar Elves).
//
// The rules, per format the generator builds (it treats every format other
// than Brawl and Pauper Commander as Commander, and so does this):
//   - Commander (CR 903.3): a legendary creature, Vehicle, or Spacecraft with
//     a power/toughness box, or a card whose text says it "can be your
//     commander" (903.3a). Grist, the Hunger Tide counts: it is a creature
//     card everywhere but the battlefield. Then Scryfall's `commander`
//     legality must be legal (a banned card, a card not legal in the format,
//     or one that hasn't been released yet all refuse).
//   - Brawl: the same, plus any legendary planeswalker, against the `brawl`
//     legality.
//   - Pauper Commander: an uncommon creature that isn't banned, the app's
//     existing rule (lib/commanders isPdhCommanderEligible).
//   - A second commander must pair with the first the way the app pairs them
//     everywhere else (areValidPartners: Partner, Partner with, Friends
//     forever, Choose a Background, Doctor's companion). A Background is a
//     legal second commander beside a commander that chooses one.
//
// "Banned as a commander" is not its own list: the official Commander list
// bans no card as a commander only (Lutri, the Spellchaser is banned as a
// companion, and is a legal commander), so Scryfall's `banned` status is the
// whole answer.
import type { Customization, ScryfallCard } from '@/deck-builder/types';
import { isPdhCommanderEligible } from '@/lib/commanders';
import { frontFaceName } from '@/lib/card-text';
import { areValidPartners } from '@/deck-builder/lib/partnerUtils';

export type CommanderIneligibleReason =
  | 'banned'
  | 'unreleased'
  | 'not-legal'
  | 'not-a-commander'
  | 'pdh-not-uncommon-creature'
  | 'invalid-pair';

export interface CommanderIneligibility {
  /** The card at fault, as its full Scryfall name. */
  cardName: string;
  reason: CommanderIneligibleReason;
  /** The sentence the player reads. */
  message: string;
}

/** Thrown by the generator's entry when the command zone isn't legal. */
export class CommanderIneligibleError extends Error {
  readonly reason: CommanderIneligibleReason;
  readonly cardName: string;
  constructor(ineligibility: CommanderIneligibility) {
    super(ineligibility.message);
    this.name = 'CommanderIneligibleError';
    this.reason = ineligibility.reason;
    this.cardName = ineligibility.cardName;
  }
}

type CommanderFormat = 'commander' | 'brawl' | 'paupercommander';

function formatOf(mtgFormat: Customization['mtgFormat']): CommanderFormat {
  return mtgFormat === 'brawl' || mtgFormat === 'paupercommander' ? mtgFormat : 'commander';
}

const FORMAT_LABEL: Record<CommanderFormat, string> = {
  commander: 'Commander',
  brawl: 'Brawl',
  paupercommander: 'Pauper Commander',
};

/** A card's front face type line: the face a commander is chosen by. */
function frontTypeLine(card: ScryfallCard): string {
  return (card.card_faces?.[0]?.type_line ?? card.type_line ?? '').split('//')[0];
}

function allText(card: ScryfallCard): string {
  return [card.oracle_text, ...(card.card_faces ?? []).map((f) => f.oracle_text)]
    .filter(Boolean)
    .join('\n');
}

function isBackground(card: ScryfallCard): boolean {
  return /\bBackground\b/.test(frontTypeLine(card));
}

/** The type half of the rule: could this card be a commander at all. */
function canLeadByType(card: ScryfallCard, format: CommanderFormat): boolean {
  const text = allText(card);
  if (/\bcan be your commander\b/i.test(text)) return true;
  const type = frontTypeLine(card);
  if (!/\bLegendary\b/.test(type)) return false;
  if (/\bCreature\b/.test(type) || /\bVehicle\b/.test(type)) return true;
  // A Spacecraft only with a power/toughness box (Station cards print one).
  if (/\bSpacecraft\b/.test(type) && card.power != null) return true;
  // Grist, the Hunger Tide: "As long as Grist isn't on the battlefield, it's
  // a 1/1 Insect creature in addition to its other types."
  if (/isn't on the battlefield, it's an? [^.\n]*\bcreature\b/i.test(text)) return true;
  return format === 'brawl' && /\bPlaneswalker\b/.test(type);
}

function releasedAfter(card: ScryfallCard, now: Date): boolean {
  return !!card.released_at && card.released_at > now.toISOString().slice(0, 10);
}

/**
 * Why one card can't sit in the command zone, or null when it can.
 * `pairedWithBackgroundChooser`: the other commander chooses a Background,
 * which makes a Background a legal second commander.
 */
function cardIneligibility(
  card: ScryfallCard,
  format: CommanderFormat,
  now: Date,
  pairedWithBackgroundChooser: boolean
): CommanderIneligibility | null {
  const name = frontFaceName(card.name);
  const label = FORMAT_LABEL[format];
  const fail = (reason: CommanderIneligibleReason, message: string): CommanderIneligibility => ({
    cardName: card.name,
    reason,
    message,
  });
  const background = pairedWithBackgroundChooser && isBackground(card);

  if (format === 'paupercommander') {
    if (card.legalities?.paupercommander === 'banned') {
      return fail('banned', `${name} is banned in ${label}.`);
    }
    const eligible = background ? card.rarity === 'uncommon' : isPdhCommanderEligible(card);
    return eligible
      ? null
      : fail(
          'pdh-not-uncommon-creature',
          `${name} isn't an uncommon creature, so it can't lead a ${label} deck.`
        );
  }

  if (!background && !canLeadByType(card, format)) {
    return fail(
      'not-a-commander',
      format === 'brawl'
        ? `${name} isn't a legendary creature or planeswalker, so it can't be your commander.`
        : `${name} isn't a legendary creature, so it can't be your commander.`
    );
  }
  const status = card.legalities?.[format];
  if (status === 'legal' || status === 'restricted') return null;
  if (status === 'banned') return fail('banned', `${name} is banned in ${label}.`);
  if (releasedAfter(card, now)) {
    return fail('unreleased', `${name} isn't legal in ${label} until it releases.`);
  }
  return fail('not-legal', `${name} isn't legal in ${label}.`);
}

/**
 * Why this command zone can't build in this format, or null when it can.
 * Checks the commander, then the second commander, then the pairing, and
 * names the first problem.
 */
export function commanderIneligibility(
  commander: ScryfallCard,
  partner: ScryfallCard | null | undefined,
  mtgFormat: Customization['mtgFormat'],
  now: Date = new Date()
): CommanderIneligibility | null {
  const format = formatOf(mtgFormat);
  const chooses = (c: ScryfallCard | null | undefined) =>
    !!c && /\bChoose a Background\b/i.test(allText(c));
  const first = cardIneligibility(commander, format, now, chooses(partner));
  if (first) return first;
  if (!partner) return null;
  const second = cardIneligibility(partner, format, now, chooses(commander));
  if (second) return second;
  if (!areValidPartners(commander, partner)) {
    return {
      cardName: partner.name,
      reason: 'invalid-pair',
      message: `${frontFaceName(partner.name)} can't be a second commander with ${frontFaceName(commander.name)}.`,
    };
  }
  return null;
}

/** The generator's entry gate: throws CommanderIneligibleError, or returns. */
export function assertCommandersEligible(ctx: {
  commander: ScryfallCard;
  partnerCommander?: ScryfallCard | null;
  customization: Pick<Customization, 'mtgFormat'>;
}): void {
  const problem = commanderIneligibility(
    ctx.commander,
    ctx.partnerCommander,
    ctx.customization.mtgFormat
  );
  if (problem) throw new CommanderIneligibleError(problem);
}
