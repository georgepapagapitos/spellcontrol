import type { GamePhase } from '@/lib/game-state';

/**
 * "At the beginning of …" triggers, read straight off a permanent's oracle
 * text, so the board can name what is due at a boundary instead of leaving
 * the player to remember it.
 *
 * This is the one thing every free manual client gives up against MTGO and
 * XMage, and the only part of automation worth having here: a list of names,
 * advisory, never applied. Nothing in this module validates a rule, checks an
 * intervening-if, or asks whether the trigger would do anything.
 *
 * Scope is deliberately one templating family — a clause opening with "at the
 * beginning of". Those are the boundary triggers, the ones nothing on the
 * table prompts you for. "Whenever …" fires off plays the player is already
 * making, and including it would list most of the board most of the time.
 *
 * ⚠️ Reminder text is NOT stripped, which is the opposite of what the rest of
 * the codebase does with oracle text, and it is deliberate. Echo, cumulative
 * upkeep, fading and vanishing all carry their upkeep trigger ONLY inside the
 * parenthetical:
 *
 *   Echo {3}{W}{W} (At the beginning of your upkeep, if this came under your
 *   control since the beginning of your last upkeep, sacrifice it unless you
 *   pay its echo cost.)
 *
 * Those are exactly the triggers a player forgets, and stripping the
 * parentheses drops every one of them. False positives do not arise in
 * practice: a reminder carrying the phrase is always describing that card's
 * own trigger. Suspend is the theoretical exception and cannot occur here,
 * since a suspended card sits in exile and this only ever reads the
 * battlefield.
 *
 * Known gap, named rather than hidden: "at end of combat" has no beat on the
 * advisory phase clock (`GamePhase` collapses the turn into five), so those
 * triggers are not reported at all rather than reported at the wrong moment.
 */

/** A trigger found on one card: when it fires, and on whose turn. */
export interface TriggerHit {
  beat: GamePhase;
  /** `own` fires on your turn, `table` on every turn (or an opponent's). */
  scope: 'own' | 'table';
}

/**
 * Every "at the beginning of …" clause, captured up to the comma that ends
 * the trigger's condition. A global match, because a card can carry two
 * (Sheoldred, Whispering One triggers on your upkeep and on each opponent's).
 */
const TRIGGER_CLAUSE = /at the beginning of ([^,.;\n)]*)/gi;

/**
 * Which beats a trigger's condition names. Returns more than one only for the
 * unqualified "each of your main phases", which genuinely fires twice.
 *
 * Order is load-bearing: "postcombat main phase" contains "combat", and
 * "first main phase" must be read before the bare "main phase".
 */
function beatsFor(condition: string): GamePhase[] {
  // A delayed trigger set up by a spell or an activated ability ("exile it at
  // the beginning of the next end step"). Nothing on the permanent says
  // whether one is armed this turn, so reporting it would be a guess.
  if (/\bthe next\b/.test(condition)) return [];
  if (/\bupkeep\b|\bdraw step\b|\buntap step\b/.test(condition)) return ['beginning'];
  if (/postcombat main phase/.test(condition)) return ['main2'];
  if (/first main phase|precombat main phase/.test(condition)) return ['main1'];
  if (/\bmain phases?\b/.test(condition)) return ['main1', 'main2'];
  if (/\bcombat\b/.test(condition)) return ['combat'];
  if (/\bend step\b/.test(condition)) return ['end'];
  return [];
}

/**
 * The triggers in one card's oracle text.
 *
 * "your" anywhere in the condition makes it yours ("each of your postcombat
 * main phases"); anything else is the whole table ("each opponent's upkeep",
 * "each player's draw step", "the end step").
 */
export function matchTriggers(oracleText: string | undefined): TriggerHit[] {
  if (!oracleText) return [];
  const hits: TriggerHit[] = [];
  const seen = new Set<string>();
  for (const m of oracleText.matchAll(TRIGGER_CLAUSE)) {
    const condition = m[1].toLowerCase();
    const scope = /\byour\b/.test(condition) ? 'own' : 'table';
    for (const beat of beatsFor(condition)) {
      const key = `${beat}:${scope}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ beat, scope });
    }
  }
  return hits;
}

/** Does this card want the player's attention at `beat`, on this turn? */
export function firesAt(hits: readonly TriggerHit[], beat: GamePhase, myTurn: boolean): boolean {
  return hits.some((h) => h.beat === beat && (myTurn || h.scope === 'table'));
}

/** Beat headings, in the player's words rather than the reducer's. */
export const BEAT_LABEL: Record<GamePhase, string> = {
  beginning: 'Upkeep',
  main1: 'First main',
  combat: 'Combat',
  main2: 'Second main',
  end: 'End step',
};
