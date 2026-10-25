/**
 * Card draw and selection, read from Oracle text once per card.
 *
 * A goldfish that draws one card a turn is draw-bound: the assembly clock's
 * medians moved from t8 to t6 and t18 to t13 the day casting a draw spell was
 * first worth two cards (#1534). This reads what each spell actually does, so a
 * Brainstorm (three cards, two go back) is not a Divination (two cards) is not
 * a Phyrexian Arena (one card a turn, forever).
 *
 * Recognized, in the spell's own text or its enters trigger:
 *
 * - "draw N cards" (Divination, Sign in Blood, Mulldrifter's enters trigger),
 *   with "then put N cards from your hand on top of your library" (Brainstorm)
 *   or "then discard N cards" (Faithless Looting) after it;
 * - "exile the top N cards of your library, you may play them" (Reckless Impulse,
 *   Light Up the Stage), read as drawing N;
 * - "look at the top N cards of your library" with "put M of them into your
 *   hand" (Impulse, Dig Through Time), or followed by a draw (Ponder: the card
 *   drawn is the best of the top N);
 * - "scry N" and "surveil N", alone or with a draw (Opt, Preordain, Serum Visions);
 * - "at the beginning of your upkeep / draw step / end step, draw N" (Phyrexian
 *   Arena, Font of Mythos): N cards every turn from the turn after it is cast.
 *
 * Not recognized, so the card reads as no draw (the tagger's `cardDraw` role
 * then stands in for it): triggers that depend on what happens in the game
 * ("whenever a creature dies, draw"), X draws, activated abilities, effects an
 * opponent controls (Rhystic Study), and draws that go to an opponent.
 */

import type { DrawEffect } from './types';

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
};
const NUM = '(a|an|one|two|three|four|five|six|seven|\\d+)';

const num = (w: string): number => (/^\d+$/.test(w) ? Number(w) : (NUMBER_WORDS[w] ?? 0));

/** Lines about someone else's cards, or conditional on play, that never read as the caster's draw. */
const NOT_OURS =
  /\b(each opponent|target opponent|that player|its controller|each player|unless|if you would|whenever|you may pay)\b/;

const EMPTY: DrawEffect = {
  draw: 0,
  putBack: 0,
  discard: 0,
  look: 0,
  take: 0,
  scry: 0,
  scryFirst: false,
  perTurn: 0,
};

function effectOf(sentence: string): DrawEffect {
  const e = { ...EMPTY };
  const draw = sentence.match(new RegExp(`\\bdraws? ${NUM} (?:additional )?cards?\\b`));
  if (draw) e.draw = num(draw[1]);
  const back = sentence.match(
    new RegExp(`\\bput ${NUM} cards? from your hand on top of your library\\b`)
  );
  if (back) e.putBack = num(back[1]);
  const discard = sentence.match(new RegExp(`\\bthen discard ${NUM} cards?\\b`));
  if (discard) e.discard = num(discard[1]);
  // "Exile the top two cards of your library. You may play them this turn": drawn, if played.
  const exile = sentence.match(
    new RegExp(`\\bexile the top ${NUM} cards? of your library\\b.*\\byou may (?:play|cast)\\b`)
  );
  if (exile) e.draw += num(exile[1]);
  const look = sentence.match(new RegExp(`\\blook at the top ${NUM} cards? of your library\\b`));
  if (look) {
    e.look = num(look[1]);
    const take = sentence.match(new RegExp(`\\bput ${NUM}(?: of them| cards?)? into your hand\\b`));
    if (take) e.take = num(take[1]);
  }
  const scry = sentence.match(new RegExp(`\\b(?:scry|surveil) ${NUM}\\b`));
  if (scry) {
    e.scry = num(scry[1]);
    // Scry before the draw helps this draw; scry after it only the next ones.
    e.scryFirst = draw === null || (scry.index ?? 0) < (draw.index ?? 0);
  }
  return e;
}

const isEmpty = (e: DrawEffect): boolean => e.draw === 0 && e.take === 0 && e.scry === 0;

/**
 * What casting this card does for the hand. Null when it does not draw or
 * select.
 */
export function parseDraw(face: {
  name: string;
  typeLine: string;
  text: string | undefined;
}): DrawEffect | null {
  const text = (face.text ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/"[^"]*"/g, '');
  const spell = /\b(instant|sorcery)\b/.test(face.typeLine.toLowerCase());
  const total = { ...EMPTY };
  let found = false;

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !NOT_OURS.test(l));
  const add = (e: DrawEffect): void => {
    if (isEmpty(e)) return;
    total.draw += e.draw;
    total.putBack += e.putBack;
    total.discard += e.discard;
    total.look = Math.max(total.look, e.look);
    total.take += e.take;
    total.scry += e.scry;
    total.scryFirst ||= e.scryFirst;
    found = true;
  };

  if (spell) {
    // A spell's effect is every line that is not an ability: "Look at the top
    // three cards... You may shuffle." and "Draw a card." are one Ponder.
    add(effectOf(lines.filter((l) => !l.includes(':')).join(' ')));
  }
  for (const line of lines) {
    const turnly = line.match(/^at the beginning of your (?:upkeep|draw step|end step), (.*)$/);
    if (turnly) {
      const e = effectOf(turnly[1]);
      if (e.draw > 0 && !/\bexile\b|\bsacrifice\b|on top of your library/.test(line)) {
        total.perTurn += e.draw;
        found = true;
      }
      continue;
    }
    if (spell) continue;
    // "When Mulldrifter enters, draw two cards." Only the card's own enters trigger.
    const self = `(?:this [a-z]+|${face.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`;
    const etb = line.match(new RegExp(`^when ${self} enters(?: the battlefield)?, (?:you )?(.*)$`));
    if (etb) add(effectOf(etb[1]));
  }
  return found ? total : null;
}
