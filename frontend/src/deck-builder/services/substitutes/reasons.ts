/**
 * Grounded "why this substitute" factors for v2 (E517), in the WhyBreakdown
 * format every suggestion row already uses (lib/why-factors.ts).
 *
 * Every line reads off a fact the ranker scored, never a comparison it didn't
 * make and never a "% match" (STYLE_GUIDE decks appendix, "Collection lane —
 * owned alternatives"): the same effect in plain words when the two cards
 * share a (trigger, effect) tuple, a narrower target or slower speed when the
 * substitute gives something up, the deck link when the deck feeds it, and
 * EDHREC provenance when a similar list names the pair. When a tuple has no
 * phrasing here, the line names the card instead of guessing at words.
 */
import type { WhyFactor } from '@/lib/why-factors';
import type { AbilityFact, CardFacts, EffectSig, TriggerSig } from '../cardFacts/schema';
import { roleAbilities } from './features';
import type { SubstituteScore } from './ranker';

// ── Plain-words phrasing of a tuple ────────────────────────────────────────

/** Singular with article, and plural, for the object nouns the parser emits. */
const NOUNS: Record<string, [string, string]> = {
  creature: ['a creature', 'creatures'],
  token: ['a creature token', 'creature tokens'],
  land: ['a land', 'lands'],
  artifact: ['an artifact', 'artifacts'],
  enchantment: ['an enchantment', 'enchantments'],
  planeswalker: ['a planeswalker', 'planeswalkers'],
  battle: ['a battle', 'battles'],
  permanent: ['a permanent', 'permanents'],
  'nonland-permanent': ['a nonland permanent', 'nonland permanents'],
  spell: ['a spell', 'spells'],
  'spell:noncreature': ['a noncreature spell', 'noncreature spells'],
  'spell:creature': ['a creature spell', 'creature spells'],
  'spell:instant-sorcery': ['an instant or sorcery spell', 'instant and sorcery spells'],
  'noncreature-spell': ['a noncreature spell', 'noncreature spells'],
  'creature-spell': ['a creature spell', 'creature spells'],
  'instant-sorcery-spell': ['an instant or sorcery spell', 'instant and sorcery spells'],
  card: ['a card', 'cards'],
  'card:creature': ['a creature card', 'creature cards'],
  'card:permanent': ['a permanent card', 'permanent cards'],
  'card:artifact': ['an artifact card', 'artifact cards'],
  'card:any': ['a card', 'cards'],
  'land:basic': ['a basic land card', 'basic land cards'],
};

/** "creature|planeswalker" → "creature or planeswalker"; null when any part has no phrasing. */
function noun(object: string, plural = false): string | null {
  const parts = object.split('|').map((p) => NOUNS[p]);
  if (parts.some((p) => !p)) return null;
  if (parts.length === 1) return parts[0][plural ? 1 : 0];
  const bare = parts.map((p) => p[1]);
  return plural
    ? bare.join(' and ')
    : `${parts[0][0].split(' ')[0]} ${bare.map((b) => b.replace(/s$/, '')).join(' or ')}`;
}
/** The noun without its article: "a creature" → "creature". */
const bare = (object: string) => noun(object)?.replace(/^an? /, '') ?? null;

const CONTROLS: Record<string, string> = { you: ' you control', opp: ' an opponent controls' };

function triggerWords(t: TriggerSig): string | null {
  const who = t.who;
  if (t.object === 'self') {
    const self: Record<string, string> = {
      enters: 'when it enters',
      dies: 'when it dies',
      leaves: 'when it leaves the battlefield',
      attacks: 'whenever it attacks',
    };
    return self[t.event] ?? null;
  }
  const subject = noun(t.object);
  const step = (name: string) =>
    who === 'you'
      ? `at the beginning of your ${name}`
      : who === 'opp'
        ? `at the beginning of each opponent's ${name}`
        : `at the beginning of each ${name}`;
  const player = who === 'you' ? 'you' : who === 'opp' ? 'an opponent' : 'a player';
  switch (t.event) {
    case 'enters':
    case 'dies':
    case 'attacks': {
      if (!subject) return null;
      const verb = t.event === 'attacks' ? 'attacks' : t.event;
      return `whenever ${subject}${CONTROLS[who] ?? ''} ${verb}`;
    }
    case 'leaves':
      return subject ? `whenever ${subject}${CONTROLS[who] ?? ''} leaves the battlefield` : null;
    case 'cast':
      return subject && t.object.startsWith('spell')
        ? `whenever ${player} ${who === 'you' ? 'cast' : 'casts'} ${subject}`
        : null;
    case 'draw':
      return `whenever ${player} ${who === 'you' ? 'draw' : 'draws'} a card`;
    case 'sacrifice':
      return subject && who === 'you' ? `whenever you sacrifice ${subject}` : null;
    case 'gain-life':
      return who === 'you' ? 'whenever you gain life' : null;
    case 'upkeep':
      return step('upkeep');
    case 'end-step':
      return step('end step');
    default:
      return null;
  }
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'];
const count = (amount: EffectSig['amount'], one: string, many: string) =>
  amount === null || amount === 1
    ? one
    : `${typeof amount === 'number' ? (NUMBER_WORDS[amount] ?? amount) : amount} ${many}`;

function effectWords(e: EffectSig): string | null {
  const mass = e.scope === 'mass';
  const plural = noun(e.object, true);
  const target = bare(e.object);
  const whose = (w: string) =>
    w === 'opp' ? ' your opponents control' : w === 'you' ? ' you control' : '';
  const single = (w: string) =>
    w === 'opp' ? ' an opponent controls' : w === 'you' ? ' you control' : '';
  const move = (verb: string, tail = '') =>
    mass
      ? plural && `${verb} all ${plural}${whose(e.who)}${tail}`
      : target && `${verb} target ${target}${single(e.who)}${tail}`;
  switch (e.verb) {
    case 'destroy':
    case 'exile':
      return move(e.verb);
    case 'bounce':
      return mass
        ? move('return', " to their owners' hands")
        : move('return', " to its owner's hand");
    case 'counter':
      return target && !mass ? `counter target ${target}` : null;
    case 'sacrifice': {
      const one = noun(e.object);
      if (!one) return null;
      if (e.who === 'opp') return `each opponent sacrifices ${one}`;
      if (e.who === 'each') return `each player sacrifices ${one}`;
      return null;
    }
    case 'tap':
      return move('tap');
    case 'steal':
      return target && !mass ? `gain control of target ${target}${single(e.who)}` : null;
    case 'draw':
      return e.who === 'you' ? `draw ${count(e.amount, 'a card', 'cards')}` : null;
    case 'add-mana':
      return e.who === 'you' ? 'add mana' : null;
    case 'gain-life':
      return e.who === 'you' ? 'you gain life' : null;
    case 'lose-life':
      return e.who === 'opp' ? 'each opponent loses life' : null;
    case 'token':
      if (e.who !== 'you') return null;
      if (e.object === 'token:treasure') return 'create a Treasure token';
      if (e.object === 'token:creature') return 'create a creature token';
      return null;
    case 'search':
      return e.who === 'you' && target ? `search your library for ${noun(e.object)}` : null;
    case 'regrow':
      return target ? `return ${noun(e.object)} from your graveyard to your hand` : null;
    case 'reanimate':
      return target && e.who === 'you'
        ? `return ${noun(e.object)} from your graveyard to the battlefield`
        : null;
    default:
      return null;
  }
}

/** The tag similarity.ts builds for one (ability, effect): the key the ranker matched on. */
function tupleTag(a: AbilityFact, e: EffectSig): string {
  const effect = `E:${e.verb}/${e.object}/${e.who}${e.scope === 'mass' ? '@mass' : ''}`;
  return a.trigger
    ? `T:${a.trigger.event}/${a.trigger.object}/${a.trigger.who}>${effect}`
    : `K:${a.kind}>${effect}`;
}

/** Plain words for one of `f`'s tuples ("whenever a creature you control dies, each opponent sacrifices a creature"), or null. */
export function tupleWords(f: CardFacts, tag: string): string | null {
  for (const a of f.abilities) {
    for (const e of a.effects) {
      if (tupleTag(a, e) !== tag) continue;
      const effect = effectWords(e);
      if (!effect) return null;
      if (!a.trigger) return a.kind === 'spell' || a.kind === 'activated' ? effect : null;
      const trigger = triggerWords(a.trigger);
      return trigger ? `${trigger}, ${effect}` : null;
    }
  }
  return null;
}

// ── Tradeoffs read off the facts ───────────────────────────────────────────

/** Atomic permanent kinds each hit covers, so "nonland permanent" contains "creature". */
const HIT_ATOMS: Record<string, string[]> = {
  creature: ['creature'],
  artifact: ['artifact'],
  enchantment: ['enchantment'],
  planeswalker: ['planeswalker'],
  battle: ['battle'],
  land: ['land'],
  'nonland-permanent': ['creature', 'artifact', 'enchantment', 'planeswalker', 'battle'],
  permanent: ['creature', 'artifact', 'enchantment', 'planeswalker', 'battle', 'land'],
  spell: ['creature-spell', 'noncreature-spell'],
  'noncreature-spell': ['noncreature-spell'],
  'instant-sorcery-spell': ['noncreature-spell'],
  'creature-spell': ['creature-spell'],
};

function hitAtoms(f: CardFacts, abilities: readonly number[]): Set<string> {
  const keep = abilities.length > 0 ? new Set(abilities) : null;
  const out = new Set<string>();
  for (const i of f.interaction) {
    if (keep && !keep.has(i.ability)) continue;
    for (const h of i.hits) for (const a of HIT_ATOMS[h] ?? []) out.add(a);
  }
  return out;
}

/** The candidate's hit list in words when it is a strict subset of the query's. */
function narrowerHits(q: CardFacts, c: CardFacts, role: string): string | null {
  const qa = hitAtoms(q, roleAbilities(q, role));
  const ca = hitAtoms(c, roleAbilities(c, role));
  if (ca.size === 0 || ca.size >= qa.size || [...ca].some((a) => !qa.has(a))) return null;
  const words = [...ca].map((a) => noun(a, true) ?? a.replace(/-/g, ' '));
  return words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

const INSTANT = new Set(['instant', 'flash']);
/** How the role's first ability reaches the table. */
function roleSpeed(f: CardFacts, role: string): string | null {
  const i = roleAbilities(f, role)[0];
  return i === undefined ? null : f.abilities[i].speed;
}

/** "Watches opponents' creatures, not yours" for a polarity clash, from the query's tuple. */
function clashWords(tag: string): string | null {
  const [trigger, effect] = tag.includes('>') ? tag.split('>') : [null, tag];
  const t = trigger?.match(/^T:[^/]+\/([^/]+)\/(\w+)/);
  if (t && (t[2] === 'you' || t[2] === 'opp')) {
    const objects = noun(t[1], true);
    if (objects)
      return t[2] === 'you'
        ? `Watches opponents' ${objects}, not yours`
        : `Watches your ${objects}, not an opponent's`;
  }
  const e = effect?.match(/^E:[^/]+\/([^/]+)\/(\w+)/);
  if (e && (e[2] === 'you' || e[2] === 'opp')) {
    const objects = noun(e[1], true);
    if (objects)
      return e[2] === 'opp'
        ? `Aimed at your ${objects}, not an opponent's`
        : `Aimed at opponents' ${objects}, not yours`;
  }
  return null;
}

export interface FactorOptions {
  /** Add mana-cost lines (the collection lane's own factors already cover a 0-1 mana gap). */
  mana: 'all' | 'gaps';
  /** Add the EDHREC provenance line (the collection lane already has its own). */
  edhrec: boolean;
  /** IDF, to name the rarest shared tuple when several match. */
  idf?: ReadonlyMap<string, number> | null;
}

/**
 * Grounded factors for "C instead of Q", best reason first: pros, then the
 * tradeoffs as cons.
 */
export function substituteFactors(
  q: CardFacts,
  c: CardFacts,
  s: SubstituteScore,
  opts: FactorOptions
): WhyFactor[] {
  const pros: WhyFactor[] = [];
  const cons: WhyFactor[] = [];
  const role = s.role ?? '';

  const shared = [...s.evidence.sharedTuples].sort(
    (a, b) => (opts.idf?.get(b) ?? 0) - (opts.idf?.get(a) ?? 0) || a.localeCompare(b)
  );
  if (shared.length > 0) {
    const words = tupleWords(q, shared[0]);
    pros.push({
      text: words ? `Same effect: ${words}` : `Same effect as ${q.name}`,
      tone: 'pro',
    });
  }
  if (s.deck) {
    const { engine, count: n } = s.deck;
    pros.push({
      text:
        s.deck.side === 'payoff'
          ? `Pays off your ${engine} engine: ${n} cards feed it`
          : `Feeds your ${engine} engine: ${n} cards pay it off`,
      tone: 'pro',
    });
  }
  if (opts.edhrec && s.evidence.similarRank !== null) {
    pros.push({ text: `A common substitute for ${q.name} on EDHREC`, tone: 'pro' });
  }

  const qs = roleSpeed(q, role);
  const cs = roleSpeed(c, role);
  if (qs && cs && INSTANT.has(qs) && cs === 'sorcery')
    cons.push({ text: 'Sorcery speed', tone: 'con' });
  else if (qs === 'sorcery' && cs && INSTANT.has(cs))
    pros.push({ text: 'Instant speed', tone: 'pro' });

  if (q.mv !== null && c.mv !== null) {
    const d = c.mv - q.mv;
    if (opts.mana === 'all' && d === 0) pros.push({ text: 'Same mana cost', tone: 'pro' });
    else if (d < 0 && (opts.mana === 'all' || d <= -2))
      pros.push({ text: `Costs ${-d} less`, tone: 'pro' });
    else if (d >= 2 || (opts.mana === 'all' && d === 1))
      cons.push({ text: `Costs ${d} more`, tone: d >= 2 ? 'con' : 'neutral' });
  }

  const narrower = narrowerHits(q, c, role);
  if (narrower) cons.push({ text: `Hits ${narrower} only`, tone: 'con' });
  if (s.evidence.polarityClash) {
    const words = clashWords(s.evidence.polarityClash);
    if (words) cons.push({ text: words, tone: 'con' });
  }
  return [...pros, ...cons];
}
