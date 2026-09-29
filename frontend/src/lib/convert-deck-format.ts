import type { DeckFormat, ScryfallCard } from '@/deck-builder/types';
import { DECK_FORMAT_CONFIGS } from '@/deck-builder/lib/constants/archetypes';
import { commanderCandidatesFor, commanderEligibleFor } from './deck-import-format';
import { isPdhCommanderEligible } from './commanders';
import { sideboardLimit, validateDeckZones, type LegalityIssue } from './deck-validation';
import { genId } from './id';
import type { Deck, DeckCard } from '../store/decks';

/**
 * Fields that describe the deck AS a deck of its old format, cleared on every
 * format switch so nothing stale survives it:
 *
 * - The commander analysis (`useCommanderBracketAnalysis` writes all of these
 *   as one object): grade, bracket estimate, role targets, gaps, hidden gems,
 *   inclusion map, plan score, misfits, EDHREC sample size, optimize swaps,
 *   cost plan, synergy, win conditions, Bracket Fit, and the signature they
 *   were computed for. The analysis ran for the old deck size (99 vs 59), or
 *   for a commander the deck may no longer have. Clearing the signature makes
 *   a commander format recompute; a format without one never shows them. The
 *   synced row carries them to the server on the next edit, and the public
 *   listing publishes `bracketOverride ?? bracketEstimation` whatever the
 *   format, so a Modern deck would otherwise advertise its old bracket.
 * - `categoryTargets`: the generator's per-category targets for the format it
 *   built in ("10 ramp of 99"), which the category view draws as gauges.
 *
 * Kept on purpose: `generationContext` (Regenerate needs a commander and reads
 * the deck's current format), `buildReport` (a record of how it was built),
 * the generation-time role snapshots (only stand-ins until the live count
 * loads), salt, and every user choice that isn't about the format
 * (`archetypeOverride`, `winConTags`, `aiScope`, tags, primer).
 */
const FORMAT_DERIVED_FIELDS = {
  deckGrade: undefined,
  bracketEstimation: undefined,
  roleTargets: undefined,
  gapAnalysis: undefined,
  hiddenGems: undefined,
  cardInclusionMap: undefined,
  planScore: undefined,
  misfits: undefined,
  edhrecNumDecks: undefined,
  optimizeSwaps: undefined,
  costPlan: undefined,
  synergyAnalysis: undefined,
  winConditions: undefined,
  bracketFit: undefined,
  gradeBracketSignature: undefined,
  categoryTargets: undefined,
} satisfies Partial<Deck>;

function commandZoneSlot(card: ScryfallCard, allocatedCopyId: string | null): DeckCard {
  // The same shape addCard mints. The allocation rides along, so the owned
  // copy the command zone claimed stays claimed by this deck.
  return { slotId: genId('slot'), card, allocatedCopyId, addedAt: Date.now() };
}

/**
 * The deck as it would be in `to`, for ONE `replaceDeck` inside `recordEdit`
 * (a single write and a single undo entry). Never removes a card:
 *
 * - To a format without a commander, the commander and partner move into the
 *   main deck with their physical-copy claims.
 * - Between commander formats, a commander the new format can't have (PDH
 *   takes an uncommon creature) moves into the main deck, and its partner
 *   goes with it. A kept commander keeps its partner unless the partner is
 *   itself illegal there, the same check the deck's validation makes.
 * - To a commander format from one without, nothing moves and the commander
 *   stays empty until the player picks one.
 *
 * Same-format calls return the deck unchanged (same reference).
 */
export function convertDeckFormat(deck: Deck, to: DeckFormat): Deck {
  if (deck.format === to) return deck;
  const target = DECK_FORMAT_CONFIGS[to];

  const keepCommander =
    target.hasCommander && !!deck.commander && commanderEligibleFor(to)(deck.commander);
  const keepPartner =
    keepCommander &&
    !!deck.partnerCommander &&
    (to !== 'paupercommander' || isPdhCommanderEligible(deck.partnerCommander));

  const moved: DeckCard[] = [];
  if (deck.commander && !keepCommander) {
    moved.push(commandZoneSlot(deck.commander, deck.commanderAllocatedCopyId ?? null));
  }
  if (deck.partnerCommander && !keepPartner) {
    moved.push(
      commandZoneSlot(deck.partnerCommander, deck.partnerCommanderAllocatedCopyId ?? null)
    );
  }

  return {
    ...deck,
    ...FORMAT_DERIVED_FIELDS,
    format: to,
    commander: keepCommander ? deck.commander : null,
    commanderAllocatedCopyId: keepCommander ? deck.commanderAllocatedCopyId : null,
    partnerCommander: keepPartner ? deck.partnerCommander : null,
    partnerCommanderAllocatedCopyId: keepPartner ? deck.partnerCommanderAllocatedCopyId : null,
    cards: moved.length > 0 ? [...deck.cards, ...moved] : deck.cards,
    // A stated bracket is a Commander bracket. Between commander formats it is
    // still the player's word, so it stays.
    bracketOverride: target.hasCommander ? deck.bracketOverride : null,
  };
}

/** "A", "A and B", "A, B, C and 2 more". */
function nameList(names: string[], cap = 3): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length <= cap) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${names.slice(0, cap).join(', ')} and ${names.length - cap} more`;
}

function flaggedNames(issues: LegalityIssue[], kind: LegalityIssue['issue']): Set<string> {
  return new Set(issues.filter((i) => i.issue === kind).map((i) => i.cardName));
}

function deckIssues(deck: Deck, format: DeckFormat): LegalityIssue[] {
  return validateDeckZones(deck.cards, deck.sideboard, DECK_FORMAT_CONFIGS[format], {
    commander: deck.commander,
    partnerCommander: deck.partnerCommander,
  }).deck;
}

/** Names flagged for `kind` after the switch that aren't flagged now. */
function newlyFlagged(
  before: LegalityIssue[],
  after: LegalityIssue[],
  kind: LegalityIssue['issue']
): number {
  const was = flaggedNames(before, kind);
  return [...flaggedNames(after, kind)].filter((n) => !was.has(n)).length;
}

/**
 * What switching THIS deck to `to` changes, as the short lines the format
 * sheet shows before the player commits. Only lines that are true for this
 * deck; a switch that changes nothing else says so. Empty for the current
 * format.
 */
export function describeFormatSwitch(deck: Deck, to: DeckFormat): string[] {
  if (deck.format === to) return [];
  const from = DECK_FORMAT_CONFIGS[deck.format];
  const target = DECK_FORMAT_CONFIGS[to];
  const next = convertDeckFormat(deck, to);
  const lines: string[] = [];

  const moved = [
    deck.commander && !next.commander ? deck.commander.name : null,
    deck.partnerCommander && !next.partnerCommander ? deck.partnerCommander.name : null,
  ].filter((n): n is string => !!n);
  if (moved.length > 0) {
    const verb = moved.length === 1 ? 'moves' : 'move';
    lines.push(
      target.hasCommander
        ? `${nameList(moved)} can't lead a ${target.label} deck, so ${moved.length === 1 ? 'it' : 'they'} ${verb} into the main deck.`
        : `${nameList(moved)} ${verb} into the main deck.`
    );
  }

  if (target.hasCommander && !next.commander) {
    const candidates = commanderCandidatesFor(
      [...next.cards, ...next.sideboard].map((c) => c.card),
      to
    ).map((c) => c.name);
    const kind = to === 'paupercommander' ? 'Uncommon creatures' : 'Legends';
    lines.push(
      candidates.length > 0
        ? `Choose a commander next. ${kind} in this deck: ${nameList(candidates)}.`
        : 'Choose a commander next.'
    );
  }

  const before = deckIssues(deck, deck.format);
  const after = deckIssues(next, to);
  const illegal = newlyFlagged(before, after, 'not-legal');
  if (illegal > 0) {
    lines.push(
      illegal === 1
        ? `1 card isn't legal in ${target.label} and gets flagged.`
        : `${illegal} cards aren't legal in ${target.label} and get flagged.`
    );
  }
  const overCopies = newlyFlagged(before, after, 'over-copy-limit');
  if (overCopies > 0) {
    const limit = target.isSingleton
      ? 'more than one copy'
      : `more than ${target.maxCopies} copies`;
    lines.push(
      overCopies === 1
        ? `1 card runs ${limit} and gets flagged.`
        : `${overCopies} cards run ${limit} and get flagged.`
    );
  }

  if (deck.sideboard.length > 0 && from.hasCommander !== target.hasCommander) {
    lines.push(
      target.hasCommander
        ? 'The sideboard stops counting toward legality.'
        : 'The sideboard counts toward legality.'
    );
  }

  // The 60-card formats register 15 sideboard cards (E468). Said only when
  // the switch starts flagging it: Modern to Pioneer keeps the same cap.
  const cap = sideboardLimit(target);
  const fromCap = sideboardLimit(from);
  const side = next.sideboard.length;
  if (cap !== null && side > cap && (fromCap === null || side <= fromCap)) {
    lines.push(`The sideboard has ${side} cards. ${target.label} allows ${cap}.`);
  }

  if (from.hasCommander && !target.hasCommander) {
    lines.push('Bracket, Coach and the upgrade plan only apply to Commander decks.');
  }

  return lines.length > 0 ? lines : ['Nothing else changes.'];
}
