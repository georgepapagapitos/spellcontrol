/**
 * Named functions with strengths (schema.ts `strengths`): what a query can ask
 * a card for ("give me grave-pact effects", "sac fodder") beyond the ten deck
 * roles. Butcher of Malakir reads { grave-pact: 1, sac-fodder: 0.4,
 * big-body: 0.3 }: a Grave Pact effect first, a body that feeds its own
 * trigger second, a large creature last.
 *
 * Strength scale, shared with TIER_WEIGHT: 1 when the function is the card's
 * main job (its first ability), 0.6 when it is a later ability, 0.25 when it
 * sits behind an ultimate or a transformed face; body traits (big-body,
 * evasion, sac-fodder) are fixed small values because a body is never the job
 * a slot is filled for.
 */
import { TIER_WEIGHT, type FlowFact, type InteractionFact, type RoleFact } from './schema';
import type { ParsedAbility } from './parse';

interface StrengthInput {
  abilities: ParsedAbility[];
  roles: RoleFact[];
  interaction: InteractionFact[];
  produces: FlowFact[];
  types: string[];
  keywords: string[];
  pt: [number | null, number | null] | null;
}

const EVASION = [
  'flying',
  'menace',
  'trample',
  'shadow',
  'fear',
  'intimidate',
  'horsemanship',
  'skulk',
];

export function computeStrengths(input: StrengthInput): Record<string, number> {
  const { abilities, roles, interaction, produces, types, keywords, pt } = input;
  const out = new Map<string, number>();
  const put = (key: string, value: number) =>
    out.set(key, Math.max(out.get(key) ?? 0, Math.round(value * 100) / 100));

  // Ability weight: the first ability with effects on its face is the main job.
  const firstOnFace = new Map<number, number>();
  abilities.forEach((a, i) => {
    if (a.effects.length > 0 && !firstOnFace.has(a.face)) firstOnFace.set(a.face, i);
  });
  const weightOf = (i: number): number => {
    const a = abilities[i];
    if (!a) return TIER_WEIGHT.secondary;
    if (a.limits.includes('ultimate') || a.limits.includes('transform'))
      return TIER_WEIGHT.incidental;
    return firstOnFace.get(a.face) === i ? TIER_WEIGHT.primary : TIER_WEIGHT.secondary;
  };

  // Every role and role subtype, at its tier's weight.
  for (const r of roles) {
    put(r.role, TIER_WEIGHT[r.tier]);
    if (r.sub) put(`${r.role}/${r.sub}`, TIER_WEIGHT[r.tier]);
  }

  const creature = types.includes('creature');
  abilities.forEach((a, i) => {
    const w = weightOf(i);
    const t = a.trigger;
    const raw = a.raw.toLowerCase();
    const creatureDies =
      t?.event === 'dies' && (t.object === 'creature' || t.object === 'token') && t.who !== 'opp';
    if (creatureDies) {
      if (a.effects.some((e) => e.verb === 'sacrifice' && (e.who === 'opp' || e.who === 'each')))
        put('grave-pact', w);
      if (
        a.effects.some(
          (e) =>
            (e.verb === 'lose-life' && e.who === 'opp') ||
            (e.verb === 'damage' && e.object === 'player')
        )
      )
        put('aristocrat-drain', w);
      if (a.effects.some((e) => e.verb === 'draw' && e.who !== 'opp')) put('death-draw', w);
      if (a.effects.some((e) => e.verb === 'token')) put('death-token', w);
    }
    // A sac outlet the controller can use again and again.
    if (
      a.kind === 'activated' &&
      a.cost.some((c) => /^sac:(?!self)/.test(c)) &&
      a.repeat !== 'once'
    )
      put('sac-outlet', a.cost.includes('mana') ? 0.6 : 1);
    // A body that pays you when it dies feeds every sacrifice deck.
    if (
      creature &&
      ((t?.event === 'dies' &&
        (t.who === 'self' ||
          /^(?:when|whenever) cardname or another\b/.test(
            raw.replace(/this creature/g, 'cardname')
          ))) ||
        (t?.event === 'leaves' && t.who === 'self'))
    )
      put('sac-fodder', 0.4);
    if (
      a.kind === 'static' &&
      a.effects.some(
        (e) =>
          e.verb === 'pump' &&
          e.scope === 'mass' &&
          e.who === 'you' &&
          !e.limits.includes('temporary')
      )
    )
      put('anthem', w);
    if (creature && a.kind === 'etb' && a.effects.length > 0) put('etb-value', Math.min(w, 0.6));
    if (a.kind === 'activated' && /\{x\}[^:]*:/.test(raw)) put('mana-sink', 0.4);
    for (const e of a.effects) {
      if (e.verb === 'blink') put('blink', w);
      if (e.verb === 'copy') put('copy', w);
      if (e.verb === 'untap' && e.object !== 'land') put('untap-engine', w);
      if (e.verb === 'extra-combat') put('extra-combat', w);
      if (e.verb === 'goad') put('goad', w);
      if (
        (e.verb === 'neutralize' || e.verb === 'tap') &&
        e.scope === 'mass' &&
        a.kind === 'static'
      )
        put('stax', w);
    }
  });

  for (const f of interaction) {
    if (f.scope !== 'mass' || f.mode === 'counter') continue;
    const w = weightOf(f.ability);
    if (f.side === 'opponents') put('one-sided-wipe', w);
    else if (f.side === 'all') put('symmetric-wipe', w);
  }
  for (const f of produces) {
    if (f.r === 'creature-token') put('token-maker', weightOf(f.ability));
    if (f.r === 'treasure') put('treasure-maker', weightOf(f.ability));
  }
  // A token maker's tokens are fodder too.
  if (produces.some((f) => f.r === 'creature-token')) put('sac-fodder', 0.4);

  // Body traits.
  const power = pt?.[0] ?? null;
  if (creature && power !== null && power >= 5) put('big-body', power >= 8 ? 0.5 : 0.3);
  if (
    creature &&
    (keywords.some((k) => EVASION.includes(k)) ||
      abilities.some((a) => /\bcan't be blocked\b/.test(a.text)))
  )
    put('evasion', 0.2);

  return Object.fromEntries([...out.entries()].sort(([a], [b]) => a.localeCompare(b)));
}
