/**
 * Card-advantage engines: a card that draws again and again (The One Ring,
 * Rhystic Study, Sylvan Library) against one that draws once. The roles term
 * counts both as one draw card each, so over a draw target the search read
 * The One Ring as surplus and traded it for a one-mana counterspell (the
 * E513 optimizer gate, Ur-Dragon and Krenko). Here:
 *
 *   engine  ENGINE_SCALE × cost(mv), for a counted card-draw fact that
 *           repeats (per turn, per event, on every activation, static)
 *
 * summed best first with decay ENGINE_DECAY: the third engine adds about
 * half of what the first did.
 */
import { countsAsRole } from '@/deck-builder/services/cardFacts';
import type { CardNote } from '../types';
import { costFactor } from './interaction';
import { nonLandCards, round2, type TermFn } from './shared';

export const ENGINE_SCALE = 0.4;
export const ENGINE_DECAY = 0.7;

const REPEATS = new Set(['per-turn', 'per-event', 'repeatable', 'static']);

export const enginesTerm: TermFn = (deck, ctx) => {
  const engines: Array<{ name: string; v: number; how: string }> = [];
  const seen = new Set<string>();
  for (const card of nonLandCards(deck)) {
    if (seen.has(card.name)) continue;
    seen.add(card.name);
    const facts = ctx.factsOf(card);
    const draw = facts.roles.find(
      (r) => r.role === 'cardDraw' && countsAsRole(r) && REPEATS.has(r.repeat)
    );
    if (!draw) continue;
    engines.push({ name: card.name, v: costFactor(facts.mv, false), how: draw.repeat });
  }
  engines.sort((a, b) => b.v - a.v || a.name.localeCompare(b.name));
  const notes: CardNote[] = [];
  let value = 0;
  engines.forEach((e, i) => {
    const v = ENGINE_SCALE * e.v * ENGINE_DECAY ** i;
    value += v;
    notes.push({
      name: e.name,
      value: v,
      note: `draw engine #${i + 1}: draws ${e.how === 'per-event' ? 'on every trigger' : e.how === 'static' ? 'continuously' : 'every turn'} (${round2(e.v)})`,
    });
  });
  return {
    value,
    summary: engines.length
      ? `${engines.length} draw engines, best ${engines[0].name}`
      : 'no repeating draw',
    cards: notes,
  };
};
