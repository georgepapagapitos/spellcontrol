/**
 * Compact, self-describing encoding of CardFacts for public/card-facts.json.
 *
 * Each card is `[oracleId, name, body]`. `body` is one string: fields split by
 * "|", list items by ";", sub-parts by "~" (abilities) or "&" (effects),
 * values by "." and value lists by "+". Every enumerated value is its index,
 * in base 36, into the vocabulary the FILE carries (`vocab`), and every free
 * string (object nouns, limits, strength keys, keywords) is an index into the
 * file's `dict`. Decoding with the file's own vocabularies means an old file
 * still reads correctly after the code's vocabularies grow.
 *
 * The build script round-trips every card through encode/decode and refuses
 * to write a snapshot that doesn't come back identical.
 */
import {
  ABILITY_KINDS,
  CARD_FACTS_VERSION,
  EFFECT_VERBS,
  FACT_ROLES,
  HITS,
  MODES,
  POLARITIES,
  PROVENANCES,
  REPEATS,
  RESOURCES,
  ROLE_SUBS,
  SCOPES,
  SIDES,
  SPEEDS,
  TIERS,
  TRIGGER_EVENTS,
  ZONES,
  type AbilityFact,
  type CardFacts,
  type EffectSig,
  type FlowFact,
  type InteractionFact,
  type Limit,
  type RoleFact,
} from './schema';

export const VOCAB = {
  kinds: ABILITY_KINDS,
  speeds: SPEEDS,
  repeats: REPEATS,
  events: TRIGGER_EVENTS,
  verbs: EFFECT_VERBS,
  zones: ZONES,
  who: POLARITIES,
  hits: HITS,
  scopes: SCOPES,
  sides: SIDES,
  tiers: TIERS,
  roles: FACT_ROLES,
  subs: ROLE_SUBS,
  modes: MODES,
  resources: RESOURCES,
  src: PROVENANCES,
} as const;
export type Vocab = { [K in keyof typeof VOCAB]: readonly string[] };

export interface SnapshotMeta {
  /** The bulk feed's own updated_at: the snapshot's age, never the wall clock. */
  generatedAt: string;
  sources: {
    scryfallOracleCards: { updatedAt: string; file: string };
    taggerTags: { generatedAt: string };
  };
  extractor: { version: number; name: string };
  llm: { model: string; promptVersion: string; cards: number } | null;
  seeds: Record<string, number>;
  universe: string;
  cards: number;
}

export type EncodedCard = [oracleId: string, name: string, body: string];

export interface Snapshot {
  version: number;
  meta: SnapshotMeta;
  vocab: Vocab;
  dict: string[];
  cards: EncodedCard[];
}

const b36 = (n: number) => n.toString(36);
const unb36 = (s: string) => parseInt(s, 36);

class Encoder {
  private readonly index = new Map<string, number>();
  readonly dict: string[] = [];
  str(s: string): string {
    let i = this.index.get(s);
    if (i === undefined) {
      i = this.dict.length;
      this.dict.push(s);
      this.index.set(s, i);
    }
    return b36(i);
  }
  strs(list: readonly string[], sep: string): string {
    return list.map((s) => this.str(s)).join(sep);
  }
}

function enumIndex(list: readonly string[], value: string): string {
  const i = list.indexOf(value);
  if (i < 0) throw new Error(`card-facts codec: "${value}" is not in its vocabulary`);
  return b36(i);
}
const enums = (list: readonly string[], values: readonly string[]) =>
  values.map((v) => enumIndex(list, v)).join('+');
const nullable = <T>(v: T | null, f: (v: T) => string) => (v === null ? '' : f(v));
const amountOut = (a: number | 'X' | null) => (a === null ? '' : a === 'X' ? 'X' : String(a));
const amountIn = (s: string): number | 'X' | null =>
  s === '' ? null : s === 'X' ? 'X' : Number(s);
const intOut = (n: number) => (n < 0 ? '-' : b36(n));
const intIn = (s: string) => (s === '-' ? -1 : unb36(s));
const pct = (n: number) => String(Math.round(n * 100));

function encodeEffect(e: EffectSig, enc: Encoder, V: Vocab): string {
  return [
    enumIndex(V.verbs, e.verb),
    enc.str(e.object),
    enumIndex(V.who, e.who),
    amountOut(e.amount),
    nullable(e.from, (z) => enumIndex(V.zones, z)),
    nullable(e.to, (z) => enumIndex(V.zones, z)),
    enums(V.hits, e.hits),
    enumIndex(V.scopes, e.scope),
    enc.strs(e.limits, '+'),
  ].join('.');
}

function encodeAbility(a: AbilityFact, enc: Encoder, V: Vocab): string {
  const trigger = a.trigger
    ? [
        enumIndex(V.events, a.trigger.event),
        nullable(a.trigger.from, (z) => enumIndex(V.zones, z)),
        nullable(a.trigger.to, (z) => enumIndex(V.zones, z)),
        enc.str(a.trigger.object),
        enumIndex(V.who, a.trigger.who),
      ].join('.')
    : '';
  return [
    b36(a.face),
    enumIndex(V.kinds, a.kind),
    enumIndex(V.speeds, a.speed),
    enumIndex(V.repeats, a.repeat),
    amountOut(a.loyalty),
    a.modal ? '1' : '',
    enc.strs(a.cost, ','),
    enc.strs(a.limits, ','),
    trigger,
    a.effects.map((e) => encodeEffect(e, enc, V)).join('&'),
  ].join('~');
}

function encodeRole(r: RoleFact, enc: Encoder, V: Vocab): string {
  return [
    enumIndex(V.roles, r.role),
    enumIndex(V.tiers, r.tier),
    nullable(r.sub, (s) => enumIndex(V.subs, s)),
    intOut(r.ability),
    b36(r.face),
    enumIndex(V.speeds, r.speed),
    enumIndex(V.repeats, r.repeat),
    enc.strs(r.limits, '+'),
    pct(r.conf),
    enums(V.src, r.src),
  ].join('.');
}

function encodeInteraction(f: InteractionFact, enc: Encoder, V: Vocab): string {
  return [
    enumIndex(V.modes, f.mode),
    enums(V.hits, f.hits),
    enumIndex(V.scopes, f.scope),
    enumIndex(V.sides, f.side),
    intOut(f.ability),
    b36(f.face),
    enumIndex(V.speeds, f.speed),
    enumIndex(V.repeats, f.repeat),
    enc.strs(f.limits, '+'),
    pct(f.conf),
    enums(V.src, f.src),
  ].join('.');
}

function encodeFlow(f: FlowFact, V: Vocab): string {
  return [
    enumIndex(V.resources, f.r),
    intOut(f.ability),
    b36(f.face),
    enumIndex(V.repeats, f.repeat),
    pct(f.conf),
    enums(V.src, f.src),
  ].join('.');
}

/**
 * Encode records against a vocabulary (the code's by default). The file
 * carries the vocabulary it was encoded with, and decoding reads that one.
 */
export function encodeSnapshot(
  meta: SnapshotMeta,
  facts: readonly CardFacts[],
  V: Vocab = VOCAB
): Snapshot {
  const enc = new Encoder();
  const cards: EncodedCard[] = facts.map((f) => [
    f.oracleId,
    f.name,
    [
      enc.str(f.layout),
      enc.strs(f.types, ','),
      enc.strs(f.keywords, ','),
      f.pt ? `${f.pt[0] ?? ''}/${f.pt[1] ?? ''}` : '',
      f.mv === null ? '' : String(f.mv),
      f.abilities.map((a) => encodeAbility(a, enc, V)).join(';'),
      f.roles.map((r) => encodeRole(r, enc, V)).join(';'),
      f.interaction.map((x) => encodeInteraction(x, enc, V)).join(';'),
      f.produces.map((x) => encodeFlow(x, V)).join(';'),
      f.payoffs.map((x) => encodeFlow(x, V)).join(';'),
      Object.entries(f.strengths)
        .map(([k, v]) => `${enc.str(k)}.${pct(v)}`)
        .join(';'),
    ].join('|'),
  ]);
  return { version: CARD_FACTS_VERSION, meta, vocab: V, dict: enc.dict, cards };
}

// ── Decoding ────────────────────────────────────────────────────────────────

const split = (s: string, sep: string) => (s === '' ? [] : s.split(sep));

export function decodeCard(
  snapshot: Pick<Snapshot, 'vocab' | 'dict'>,
  card: EncodedCard
): CardFacts {
  const { vocab, dict } = snapshot;
  const at = <T extends string>(list: readonly string[], s: string) => list[unb36(s)] as T;
  const strs = (s: string, sep: string) => split(s, sep).map((i) => dict[unb36(i)]);
  const [
    layout,
    types,
    keywords,
    pt,
    mv,
    abilities,
    roles,
    interaction,
    produces,
    payoffs,
    strengths,
  ] = card[2].split('|');
  const ptParts = pt === '' ? null : pt.split('/');
  const numOrNull = (s: string) => (s === '' ? null : Number(s));

  return {
    oracleId: card[0],
    name: card[1],
    layout: dict[unb36(layout)],
    types: strs(types, ','),
    keywords: strs(keywords, ','),
    pt: ptParts ? [numOrNull(ptParts[0]), numOrNull(ptParts[1])] : null,
    mv: numOrNull(mv),
    abilities: split(abilities, ';').map((s) => {
      const [face, kind, speed, repeat, loyalty, modal, cost, limits, trigger, effects] =
        s.split('~');
      const t = trigger === '' ? null : trigger.split('.');
      return {
        face: unb36(face),
        kind: at(vocab.kinds, kind),
        speed: at(vocab.speeds, speed),
        repeat: at(vocab.repeats, repeat),
        cost: strs(cost, ','),
        trigger: t
          ? {
              event: at(vocab.events, t[0]),
              from: t[1] === '' ? null : at(vocab.zones, t[1]),
              to: t[2] === '' ? null : at(vocab.zones, t[2]),
              object: dict[unb36(t[3])],
              who: at(vocab.who, t[4]),
            }
          : null,
        effects: split(effects, '&').map((e) => {
          const [verb, object, who, amount, from, to, hits, scope, lim] = e.split('.');
          return {
            verb: at(vocab.verbs, verb),
            object: dict[unb36(object)],
            who: at(vocab.who, who),
            amount: amountIn(amount),
            from: from === '' ? null : at(vocab.zones, from),
            to: to === '' ? null : at(vocab.zones, to),
            hits: split(hits, '+').map((h) => at(vocab.hits, h)),
            scope: at(vocab.scopes, scope),
            limits: strs(lim, '+') as Limit[],
          };
        }),
        limits: strs(limits, ',') as Limit[],
        modal: modal === '1',
        loyalty: amountIn(loyalty),
      };
    }),
    roles: split(roles, ';').map((s) => {
      const [role, tier, sub, ability, face, speed, repeat, limits, conf, src] = s.split('.');
      return {
        role: at(vocab.roles, role),
        tier: at(vocab.tiers, tier),
        sub: sub === '' ? null : at(vocab.subs, sub),
        ability: intIn(ability),
        face: unb36(face),
        speed: at(vocab.speeds, speed),
        repeat: at(vocab.repeats, repeat),
        limits: strs(limits, '+') as Limit[],
        conf: Number(conf) / 100,
        src: split(src, '+').map((x) => at(vocab.src, x)),
      };
    }),
    interaction: split(interaction, ';').map((s) => {
      const [mode, hits, scope, side, ability, face, speed, repeat, limits, conf, src] =
        s.split('.');
      return {
        mode: at(vocab.modes, mode),
        hits: split(hits, '+').map((h) => at(vocab.hits, h)),
        scope: at(vocab.scopes, scope),
        side: at(vocab.sides, side),
        ability: intIn(ability),
        face: unb36(face),
        speed: at(vocab.speeds, speed),
        repeat: at(vocab.repeats, repeat),
        limits: strs(limits, '+') as Limit[],
        conf: Number(conf) / 100,
        src: split(src, '+').map((x) => at(vocab.src, x)),
      };
    }),
    produces: split(produces, ';').map((s) => decodeFlow(s, vocab)),
    payoffs: split(payoffs, ';').map((s) => decodeFlow(s, vocab)),
    strengths: Object.fromEntries(
      split(strengths, ';').map((s) => {
        const [k, v] = s.split('.');
        return [dict[unb36(k)], Number(v) / 100];
      })
    ),
  };
}

function decodeFlow(s: string, vocab: Vocab): FlowFact {
  const [r, ability, face, repeat, conf, src] = s.split('.');
  return {
    r: vocab.resources[unb36(r)] as FlowFact['r'],
    ability: intIn(ability),
    face: unb36(face),
    repeat: vocab.repeats[unb36(repeat)] as FlowFact['repeat'],
    conf: Number(conf) / 100,
    src: split(src, '+').map((x) => vocab.src[unb36(x)] as FlowFact['src'][number]),
  };
}
