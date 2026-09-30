/**
 * Oracle text → clause-level abilities: each ability is a (trigger, effects)
 * tuple with controller polarity on both sides (see schema.ts). Grave Pact,
 * Dictate of Erebos and Butcher of Malakir all come out as
 *   trigger dies/creature/you  →  effect sacrifice/creature/opp
 * and Dictate's differs only by its flash speed.
 *
 * Pure and deterministic. Written against real Scryfall templating; every
 * branch is exercised by gold.fixtures.ts or parse.test.ts with real oracle
 * text.
 */
import type {
  AbilityFact,
  AbilityKind,
  Zone,
  EffectSig,
  EffectVerb,
  FactsInputCard,
  Hit,
  Limit,
  Polarity,
  Repeat,
  Scope,
  Speed,
  TriggerEvent,
  TriggerSig,
} from './schema';
import { normalizeLine, parseCount, selfNames, sentences } from './normalize';
import { tokenCreation } from '../synergy/text';

// ── Faces ───────────────────────────────────────────────────────────────────

export interface FaceCtx {
  index: number;
  name: string;
  typeLine: string;
  rawText: string;
  isSpell: boolean;
  isInstant: boolean;
  isLand: boolean;
  isCreature: boolean;
  isArtifact: boolean;
  isPlaneswalker: boolean;
  isAura: boolean;
  /** The face's mana cost has {X}: its "X" is chosen, not counted. */
  xCost: boolean;
  loyalty: number | null;
  /** Face-level limits: `transform` on a back face, `prepare` on a prepare spell. */
  limits: Limit[];
}

/** Layouts whose second face is only reached by transforming/flipping/melding. */
const BACK_FACE_LAYOUTS = new Set(['transform', 'flip', 'meld']);

export function facesOf(card: FactsInputCard): FaceCtx[] {
  const layout = card.layout ?? 'normal';
  const raw =
    card.card_faces && card.card_faces.length > 0
      ? card.card_faces.map((f) => ({
          name: f.name,
          type: f.type_line ?? '',
          text: f.oracle_text ?? '',
          cost: f.mana_cost ?? '',
          loyalty: f.loyalty,
        }))
      : [
          {
            name: card.name,
            type: card.type_line ?? '',
            text: card.oracle_text ?? '',
            cost: card.mana_cost ?? '',
            loyalty: card.loyalty,
          },
        ];
  return raw.map((f, index) => {
    const t = f.type.toLowerCase();
    const limits: Limit[] = [];
    if (index > 0 && BACK_FACE_LAYOUTS.has(layout)) limits.push('transform');
    if (index > 0 && layout === 'prepare') limits.push('prepare');
    const loyalty = f.loyalty && /^\d+$/.test(f.loyalty) ? Number(f.loyalty) : null;
    return {
      index,
      name: f.name,
      typeLine: t,
      rawText: f.text,
      isSpell: /\b(?:instant|sorcery)\b/.test(t),
      isInstant: /\binstant\b/.test(t),
      isLand: /\bland\b/.test(t),
      isCreature: /\bcreature\b/.test(t),
      isArtifact: /\bartifact\b/.test(t),
      isPlaneswalker: /\bplaneswalker\b/.test(t),
      isAura: /\baura\b/.test(t),
      xCost: /\{X\}/i.test(f.cost),
      loyalty,
      limits,
    };
  });
}

// ── Ability splitting ───────────────────────────────────────────────────────

/**
 * An ability plus the parse-time detail the extractor needs and the snapshot
 * doesn't store: its normalized text, sentences and each effect's sentence.
 */
export interface ParsedAbility extends AbilityFact {
  text: string;
  /** The ability's own raw line, for per-ability reuse of text classifiers. */
  raw: string;
  sentences: string[];
  /** Sentence index of each entry in `effects`. */
  effectSentence: number[];
  /** Id shared by the bullet modes of one modal spell/ability; -1 when not modal. */
  modalGroup: number;
  /** "choose one" (1), "choose two" (2), ...; 0 when not modal. */
  modalPicks: number;
}

const EVERGREEN = [
  'flying',
  'first strike',
  'double strike',
  'deathtouch',
  'haste',
  'hexproof',
  'indestructible',
  'lifelink',
  'menace',
  'reach',
  'trample',
  'vigilance',
  'defender',
  'flash',
  'ward',
  'protection',
  'shroud',
  'enchant',
  'equip',
  'changeling',
  'fear',
  'intimidate',
  'banding',
];

/** Ability words that gate an ability on a condition (not a trigger). */
const CONDITION_WORDS = new Set([
  'threshold',
  'metalcraft',
  'delirium',
  'ferocious',
  'morbid',
  'raid',
  'revolt',
  'spell mastery',
  'hellbent',
  'fateful hour',
  'formidable',
  'coven',
  'max speed',
  'descend 4',
  'descend 8',
  'corrupted',
]);

/** Words that make a line an ability, never a bare keyword with its parameter. */
const ABILITY_WORDS =
  /\b(?:when|whenever|you|target|each|draw|create|destroy|exile|return|search|counter)\b/;

/**
 * A line of keywords with their parameters ("Flying, deathtouch", "Equip {2}",
 * "Protection from black"). "Landfall — Whenever a land you control enters,
 * investigate" names two keywords too, but it is an ability.
 */
function isKeywordLine(line: string, keywords: readonly string[]): boolean {
  if (/: |^(?:when|whenever|at) /.test(line)) return false;
  const parts = line
    .replace(/\.$/, '')
    .split(/,\s*|;\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return false;
  const known = [...keywords, ...EVERGREEN];
  return parts.every((p) =>
    known.some(
      (k) =>
        p === k ||
        ((p.startsWith(`${k} `) || p.startsWith(`${k}—`)) && !ABILITY_WORDS.test(p.slice(k.length)))
    )
  );
}

/**
 * Split a trigger at the comma that ends its condition, skipping the commas of
 * a type list ("Whenever you cast a creature, artifact, or enchantment spell,
 * draw a card"). A comma followed by a type noun only continues the list when
 * the noun itself is followed by another list separator or "spell".
 */
function splitTrigger(text: string): [string, string] {
  let from = 0;
  while (true) {
    const i = text.indexOf(', ', from);
    if (i < 0) return [text, ''];
    const next = text.slice(i + 2);
    if (
      /^(?:or|and) /.test(next) ||
      /^(?:an? |another )?(?:planeswalker|artifact|enchantment|battle|land|creature|instant|sorcery|nonland|noncreature)s?(?:,| or | and | spells?\b)/.test(
        next
      )
    ) {
      from = i + 2;
      continue;
    }
    return [text.slice(0, i), next];
  }
}

const COST_START =
  /^(?:\{|sacrifice|discard|pay|remove|exile|tap|untap|return|put|reveal|collect|forage|mill|cardname|equip|crew|\d)/;

interface SplitContext {
  face: FaceCtx;
  names: string[];
  keywords: string[];
  flash: boolean;
}

/**
 * Strip quoted text a token or a static grant carries. A grant to your own
 * permanents ('creatures you control have "{T}: Add {G}."') is inlined so its
 * effect is read; a token's quoted ability is dropped (it is the token's, not
 * this card's).
 */
function unquote(text: string): string {
  return text.replace(
    /(\b(?:have|has|gain|gains)\s+)?"([^"]*)"/g,
    (_m, grant: string | undefined, inner: string) => (grant ? `${grant}${inner}` : '')
  );
}

export function splitAbilities(card: FactsInputCard, face: FaceCtx): ParsedAbility[] {
  const keywords = (card.keywords ?? []).map((k) => k.toLowerCase());
  const legendary =
    /\blegendary\b/.test(face.typeLine) || /\blegendary\b/i.test(card.type_line ?? '');
  const names = selfNames(
    card.name,
    (card.card_faces ?? []).map((f) => f.name),
    legendary
  );
  const lines = face.rawText
    .split('\n')
    .map((raw) => ({ raw, norm: normalizeLine(raw, names) }))
    .filter((l) => l.norm.length > 0);
  const flash = lines.some(
    (l) =>
      (isKeywordLine(l.norm, keywords) && /(?:^|, )flash(?:,|$)/.test(l.norm)) ||
      /\bas though it had flash\b/.test(l.norm)
  );
  const ctx: SplitContext = { face, names, keywords, flash };

  const out: ParsedAbility[] = [];
  let header: {
    kind: AbilityKind;
    trigger: TriggerSig | null;
    speed: Speed;
    repeat: Repeat;
    cost: string[];
    loyalty: number | 'X' | null;
    limits: Limit[];
    group: number;
    picks: number;
  } | null = null;
  let groupSeq = 0;

  const BULLET = /^(?:•|\+ \{[^}]*\}(?:\{[^}]*\})* —)\s*(.*)$/;
  for (const [li, { raw, norm }] of lines.entries()) {
    // Bullet modes (and Spree's "+ {1} —" modes) inherit their header.
    const mode = norm.match(BULLET);
    if (mode && header) {
      out.push(
        build(ctx, header.kind, header.trigger, mode[1], raw, {
          speed: header.speed,
          repeat: header.repeat,
          cost: header.cost,
          loyalty: header.loyalty,
          limits: [...header.limits, 'modal'],
          modal: true,
          modalGroup: header.group,
          modalPicks: header.picks,
        })
      );
      continue;
    }
    header = null;
    if (isKeywordLine(norm, keywords)) continue;

    const parsed = classifyLine(ctx, norm);
    // A modal header: its "choose" clause ends in "—", or (Jeska's Will: "Choose
    // one. If you control a commander ...") the bullets follow on the next line.
    const choose = parsed.text.match(
      /\bchoose (one|two|three|one or more|one or both|any number|up to (?:one|two|three)|both)\b/
    );
    if (choose && (/—$/.test(parsed.text) || BULLET.test(lines[li + 1]?.norm ?? ''))) {
      const picks = choose[1] === 'two' || choose[1] === 'both' ? 2 : choose[1] === 'three' ? 3 : 1;
      header = { ...parsed, group: groupSeq++, picks };
      continue;
    }
    out.push(
      build(ctx, parsed.kind, parsed.trigger, parsed.text, raw, {
        speed: parsed.speed,
        repeat: parsed.repeat,
        cost: parsed.cost,
        loyalty: parsed.loyalty,
        limits: parsed.limits,
        modal: false,
        modalGroup: -1,
        modalPicks: 0,
      })
    );
  }
  return out;
}

interface LineShape {
  kind: AbilityKind;
  trigger: TriggerSig | null;
  text: string;
  speed: Speed;
  repeat: Repeat;
  cost: string[];
  loyalty: number | 'X' | null;
  limits: Limit[];
}

function classifyLine(ctx: SplitContext, norm: string): LineShape {
  const { face } = ctx;
  const limits: Limit[] = [];
  let text = norm;

  // Saga chapters.
  const chapter = text.match(/^(?:i|ii|iii|iv|v|vi)(?:, (?:i|ii|iii|iv|v|vi))* — (.*)$/);
  if (chapter) {
    return {
      kind: 'chapter',
      trigger: trig('chapter', 'self', 'self'),
      text: chapter[1],
      speed: 'triggered',
      repeat: 'once',
      cost: [],
      loyalty: null,
      limits,
    };
  }

  // Loyalty abilities.
  const loyal = face.isPlaneswalker ? text.match(/^([+-]?(?:\d+|x)): (.*)$/) : null;
  if (loyal) {
    const n = loyal[1].replace('+', '');
    const loyalty: number | 'X' = /x/.test(n) ? 'X' : Number(n);
    if (typeof loyalty === 'number' && face.loyalty !== null && -loyalty > face.loyalty)
      limits.push('ultimate');
    return {
      kind: 'loyalty',
      trigger: null,
      text: loyal[2],
      speed: 'sorcery',
      repeat: 'per-turn',
      cost: [],
      loyalty,
      limits,
    };
  }

  // Ability words ("Landfall — ", "Channel — ", "Threshold — ").
  const aw = text.match(/^([a-z][a-z' -]{1,30}?) — (.*)$/);
  if (aw && !/choose/.test(aw[1])) {
    if (CONDITION_WORDS.has(aw[1])) limits.push('conditional');
    text = aw[2];
  }

  // Activated: "cost: effect" (never a quoted grant).
  const colon = text.indexOf(': ');
  if (colon > 0) {
    const costText = text.slice(0, colon);
    if (
      COST_START.test(costText) &&
      !costText.includes('"') &&
      !/^(?:when|whenever|at) /.test(costText)
    ) {
      const effect = text.slice(colon + 2);
      const sorcery = /activate only as a sorcery/.test(effect);
      const perTurn = /\{t\}|\{q\}|activate only once each turn/.test(costText + ' ' + effect);
      const cost = costAtoms(costText);
      // Paying with the card itself (sacrifice, discard or exile it) spends it.
      const once = cost.some((c) => c.endsWith(':self'));
      return {
        kind: 'activated',
        trigger: null,
        text: effect,
        speed: sorcery ? 'sorcery' : 'activated',
        repeat: once ? 'once' : perTurn ? 'per-turn' : 'repeatable',
        cost,
        loyalty: null,
        limits,
      };
    }
  }

  // Triggers.
  if (/^(?:when|whenever|at) /.test(text)) {
    const [clause, rest] = splitTrigger(text);
    const trigger = parseTrigger(clause);
    let body = rest;
    // Intervening "if": "When cardname enters, if it was kicked, destroy ...".
    const iff = body.match(/^if ([^,]*), (.*)$/);
    if (iff) {
      limits.push(
        /kicked|bargained|gift was promised|additional cost/.test(iff[1])
          ? 'additional-cost'
          : 'conditional'
      );
      body = iff[2];
    }
    const selfEnters =
      trigger.event === 'enters' && trigger.who === 'self' && /^when /.test(clause);
    const atBeginning = /^at /.test(clause);
    return {
      kind: selfEnters ? 'etb' : 'trigger',
      trigger,
      text: body,
      speed: selfEnters ? (ctx.flash ? 'flash' : 'sorcery') : 'triggered',
      repeat:
        selfEnters || /^when /.test(clause)
          ? 'once'
          : atBeginning || /triggers only once each turn/.test(body)
            ? 'per-turn'
            : 'per-event',
      cost: [],
      loyalty: null,
      limits,
    };
  }

  if (face.isSpell) {
    return {
      kind: 'spell',
      trigger: null,
      text,
      speed: face.isInstant ? 'instant' : 'sorcery',
      repeat: 'once',
      cost: [],
      loyalty: null,
      limits,
    };
  }
  return {
    kind: 'static',
    trigger: null,
    text,
    speed: 'static',
    repeat: 'static',
    cost: [],
    loyalty: null,
    limits,
  };
}

function build(
  ctx: SplitContext,
  kind: AbilityKind,
  trigger: TriggerSig | null,
  text: string,
  raw: string,
  rest: {
    speed: Speed;
    repeat: Repeat;
    cost: string[];
    loyalty: number | 'X' | null;
    limits: Limit[];
    modal: boolean;
    modalGroup: number;
    modalPicks: number;
  }
): ParsedAbility {
  const sents = sentences(unquote(text));
  const effects: EffectSig[] = [];
  const effectSentence: number[] = [];
  sents.forEach((s, i) => {
    for (const e of parseSentence(s, { face: ctx.face, abilityText: text, kind })) {
      if (!effects.some((x) => sameEffect(x, e))) {
        effects.push(e);
        effectSentence.push(i);
      }
    }
  });
  for (const e of parseAbilityLevel(text)) {
    if (!effects.some((x) => sameEffect(x, e))) {
      effects.push(e);
      effectSentence.push(0);
    }
  }
  return {
    face: ctx.face.index,
    kind,
    speed: rest.speed,
    repeat: rest.repeat,
    cost: rest.cost,
    trigger,
    effects,
    limits: [
      ...new Set([
        ...rest.limits,
        ...ctx.face.limits,
        // A tax the opponent may pay to stop it (Rhystic Study, Esper Sentinel, Mana Leak).
        ...(/\bunless (?:that player|its controller|they|he or she|the player) pays?\b/.test(text)
          ? (['unless-pays'] as Limit[])
          : []),
      ]),
    ],
    modal: rest.modal,
    loyalty: rest.loyalty,
    text,
    raw,
    sentences: sents,
    effectSentence,
    modalGroup: rest.modalGroup,
    modalPicks: rest.modalPicks,
  };
}

function sameEffect(a: EffectSig, b: EffectSig): boolean {
  return a.verb === b.verb && a.object === b.object && a.who === b.who && a.scope === b.scope;
}

// ── Costs ───────────────────────────────────────────────────────────────────

export function costAtoms(cost: string): string[] {
  const atoms = new Set<string>();
  if (/\{t\}/.test(cost)) atoms.add('tap');
  if (/\{q\}/.test(cost)) atoms.add('untap');
  if (/\{(?:\d+|x|[wubrgc]|[wubrg]\/[wubrgp])\}/.test(cost)) atoms.add('mana');
  const sac = cost.match(
    /sacrifice (?:a|an|another|one|two|three|x|\d+|cardname)\s?(?:other )?([a-z]+)?/
  );
  if (sac)
    atoms.add(sac[0].includes('cardname') ? 'sac:self' : `sac:${singular(sac[1] ?? 'permanent')}`);
  if (/discard cardname/.test(cost)) atoms.add('discard:self');
  else if (/discard/.test(cost)) atoms.add('discard');
  if (/(?:^|, )exile cardname\b/.test(cost)) atoms.add('exile:self');
  if (/pay \d+ life|pay x life/.test(cost)) atoms.add('life');
  if (/exile [^,]*from your graveyard/.test(cost)) atoms.add('exile-gy');
  if (/remove [^,]*counter/.test(cost)) atoms.add('remove-counter');
  if (/\{e\}/.test(cost)) atoms.add('energy');
  if (/tap (?:an|two|three|x|\d+|one) untapped/.test(cost)) atoms.add('tap-others');
  return [...atoms].sort();
}

function singular(word: string): string {
  return word.replace(/(?<=[a-z])s$/, '');
}

// ── Triggers ────────────────────────────────────────────────────────────────

const OBJECT_NOUNS: [RegExp, string][] = [
  [/\bnontoken creatures?\b/, 'creature'],
  [/\bcreature tokens?\b/, 'token'],
  [/\bcreatures?\b/, 'creature'],
  [/\blands?\b/, 'land'],
  [/\bartifacts?\b/, 'artifact'],
  [/\benchantments?\b/, 'enchantment'],
  [/\bplaneswalkers?\b/, 'planeswalker'],
  [/\btokens?\b/, 'token'],
  [/\bequipment\b/, 'equipment'],
  [/\bpermanents?\b/, 'permanent'],
  [/\bcards?\b/, 'card'],
];

function nounOf(phrase: string): string {
  for (const [re, noun] of OBJECT_NOUNS) if (re.test(phrase)) return noun;
  return 'other';
}

/** Whose object: "you control" → you, "an opponent controls" → opp, bare → any. */
export function polarityOf(phrase: string): Polarity {
  if (
    /\b(?:you don'?t control|an opponent controls|your opponents control|opponents control|target opponent controls|defending player controls|an opponent owns|they control)\b/.test(
      phrase
    )
  )
    return 'opp';
  if (/\b(?:you control|you own|your)\b/.test(phrase)) return 'you';
  return 'any';
}

export function parseTrigger(clause: string): TriggerSig {
  const c = clause.replace(/^(?:when|whenever|at)\s+/, '');
  const step = c.match(
    /^the beginning of (?:(your|each|each opponent's|each player's|that player's|the|the next|each of your)\s+)?(upkeep|end step|combat|draw step|precombat main phase|first main phase|main phase|second main phase|postcombat main phase)(?: on your turn)?/
  );
  if (step) {
    const who: Polarity =
      step[1] === 'your' || step[1] === 'each of your' || /on your turn/.test(c)
        ? 'you'
        : step[1] === "each opponent's"
          ? 'opp'
          : 'each';
    const event: TriggerEvent =
      step[2] === 'upkeep'
        ? 'upkeep'
        : step[2] === 'end step'
          ? 'end-step'
          : step[2] === 'combat'
            ? 'combat'
            : step[2] === 'draw step'
              ? 'draw-step'
              : 'main-phase';
    return trig(event, 'turn', who);
  }

  // Subject: everything before the first event verb.
  const verb = c.match(
    /\b(enters|is put onto the battlefield|dies|die|is put into (?:a|your|an opponent's) graveyard from the battlefield|leaves? the battlefield|attacks?|blocks?|becomes blocked|deals? combat damage|deals? damage|is dealt damage|casts?|copies|draws?|discards?|sacrifices?|is sacrificed|gains? life|loses? life|tap[s]? [^,]*? for mana|is tapped for mana|(?:counters? (?:is|are) put)|puts? one or more [^,]*? counters|creates? (?:a|one or more) [^,]*?tokens?|cycles?|cycle or discard|becomes? the target|leave your graveyard|mills?)\b/
  );
  if (!verb) return trig('other', 'other', 'any');
  const subject = c.slice(0, verb.index).trim();
  const v = verb[1];
  let who: Polarity;
  if (subject === 'cardname') who = 'self';
  else if (/^you\b/.test(subject) || /\byou control\b|\byour\b/.test(subject)) who = 'you';
  else if (/\bopponents?\b|you don'?t control/.test(subject)) who = 'opp';
  else if (/\b(?:a|each) player\b/.test(subject)) who = 'each';
  else who = 'any';
  if (/^cardname or another\b/.test(subject))
    who = polarityOf(subject) === 'any' ? 'any' : polarityOf(subject);
  // The creature an Equipment sits on is yours; an Aura's may be anyone's
  // (Martial Impetus goads an opponent's creature).
  const attached = /^equipped creature\b/.test(subject);
  if (attached) who = 'you';

  const afterVerb = c.slice((verb.index ?? 0) + v.length);
  let event: TriggerEvent;
  let object = subject === 'cardname' ? 'self' : attached ? 'equipped' : nounOf(subject);
  if (/^(?:enters|is put onto the battlefield)$/.test(v)) event = 'enters';
  else if (/^(?:dies|die)$|graveyard from the battlefield/.test(v)) event = 'dies';
  else if (/leaves? the battlefield/.test(v)) event = 'leaves';
  else if (/^attacks?$/.test(v)) event = 'attacks';
  else if (/^(?:blocks?|becomes blocked)$/.test(v)) event = 'blocks';
  else if (/combat damage/.test(v)) event = 'combat-damage';
  else if (/damage/.test(v)) event = 'damage';
  else if (/^(?:casts?|copies)$/.test(v)) {
    event = 'cast';
    const kind = afterVerb.match(
      /^ (?:or copies )?(?:a|an|your first|your second|their first|another|one or more)?\s*((?:[a-z]+ )*?)spells?/
    );
    const k = kind?.[1]?.trim() ?? '';
    object = /noncreature/.test(k)
      ? 'spell:noncreature'
      : /instant or sorcery|instant and sorcery/.test(k)
        ? 'spell:instant-sorcery'
        : /\bcreature\b/.test(k)
          ? 'spell:creature'
          : /\bartifact\b/.test(k)
            ? 'spell:artifact'
            : /\benchantment\b/.test(k)
              ? 'spell:enchantment'
              : /\b(?:instant|sorcery)\b/.test(k)
                ? 'spell:instant-sorcery'
                : subject === 'cardname' || /^ cardname/.test(afterVerb)
                  ? 'self'
                  : 'spell';
    if (/^you cast cardname$/.test(c) || /^ cardname\b/.test(afterVerb)) object = 'self';
  } else if (/^draws?$/.test(v)) {
    event = 'draw';
    object = 'card';
  } else if (/discard/.test(v) && !/cycle/.test(v)) {
    event = 'discard';
    object = 'card';
  } else if (/^(?:sacrifices?|is sacrificed)$/.test(v)) {
    event = 'sacrifice';
    object = nounOf(afterVerb.match(/^ (?:a|an|another|one or more)?\s*([a-z ]+)/)?.[1] ?? subject);
    for (const t of ['treasure', 'food', 'clue'])
      if (new RegExp(`\\b${t}\\b`).test(afterVerb)) object = `token:${t}`;
  } else if (/gains? life/.test(v)) {
    event = 'gain-life';
    object = 'life';
  } else if (/loses? life/.test(v)) {
    event = 'lose-life';
    object = 'life';
  } else if (/for mana/.test(v)) {
    event = 'tapped-for-mana';
    object = nounOf(v);
  } else if (/counters?/.test(v)) {
    event = 'counter-put';
    object = /\+1\/\+1/.test(c) ? 'p1p1' : 'counter';
  } else if (/tokens?/.test(v)) {
    event = 'token-created';
    object = 'token';
  } else if (/cycle/.test(v)) {
    event = 'cycle';
    object = 'card';
  } else if (/target/.test(v)) event = 'targeted';
  else if (/graveyard/.test(v)) {
    event = 'leave-graveyard';
    object = 'card';
  } else if (/mill/.test(v)) {
    event = 'mill';
    object = 'card';
  } else event = 'other';
  if (/^cardname\b/.test(subject) && subject !== 'cardname') {
    // "cardname or another creature you control dies": the event covers the
    // card and its kind, so the object is the kind.
    object = nounOf(subject.replace(/^cardname\b/, ''));
  }
  return trig(event, object, who);
}

// ── Effects ─────────────────────────────────────────────────────────────────

interface SentenceCtx {
  face: FaceCtx;
  abilityText: string;
  kind: AbilityKind;
}

const COUNT =
  '(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|x|\\d+|that many|any number of|up to (?:one|two|three|four|five|x|\\d+))';

/** Cut an object phrase at the start of the next clause. */
export function clip(phrase: string): string {
  return phrase
    .split(
      /,? (?:then|and then|unless|if|where|as long as|for as long as|instead)\b|, (?:you|its controller|that player|each|it|they)\b| and (?:you|its controller|that player|each player|each opponent|it|they|put|create|draw|return|exile|destroy|deal|gain|lose|untap|tap|sacrifice|its)\b/
    )[0]
    .trim();
}

const TYPE_HITS: [RegExp, Hit][] = [
  [/(?<!non-?)\bcreatures?\b(?! cards?)/, 'creature'],
  [/(?<!non-?)\bartifacts?\b(?! cards?)/, 'artifact'],
  [/(?<!non-?)\benchantments?\b(?! cards?)/, 'enchantment'],
  [/(?<!non-?)\bplaneswalkers?\b(?! cards?)/, 'planeswalker'],
  [/(?<!non-?)\b(?:nonbasic )?lands?\b(?! cards?)/, 'land'],
  [/(?<!non-?)\bbattles?\b/, 'battle'],
];

/** Which permanent types an object phrase names. */
export function hitsOf(phrase: string): Hit[] {
  if (/\bnonland permanents?\b/.test(phrase)) return ['nonland-permanent'];
  const hits: Hit[] = [];
  for (const [re, hit] of TYPE_HITS) if (re.test(phrase)) hits.push(hit);
  if (hits.length === 0 && /\bpermanents?\b/.test(phrase)) hits.push('permanent');
  if (hits.length === 0 && /\btokens?\b/.test(phrase)) hits.push('permanent');
  return hits;
}

/** Hits for a counterspell's object ("target noncreature spell", "activated or triggered ability"). */
export function spellHitsOf(phrase: string): Hit[] {
  const hits: Hit[] = [];
  const spellPart = phrase.match(/^(.*?)\bspells?\b/)?.[1];
  if (spellPart !== undefined) {
    if (/noncreature/.test(spellPart)) hits.push('noncreature-spell');
    else if (/\bcreature\b/.test(spellPart)) hits.push('creature-spell');
    if (/\b(?:instant|sorcery)\b/.test(spellPart)) hits.push('instant-sorcery-spell');
    if (
      /\b(?:artifact|enchantment|planeswalker|battle)\b/.test(spellPart) &&
      !hits.includes('noncreature-spell')
    )
      hits.push('noncreature-spell');
    if (hits.length === 0) hits.push('spell');
  }
  if (/\babilit(?:y|ies)\b/.test(phrase)) hits.push('ability');
  return hits;
}

function limitsOf(phrase: string): Limit[] {
  const limits: Limit[] = [];
  const mv = phrase.match(/(?:mana value|converted mana cost) (\d+) or (less|greater)/);
  if (mv) limits.push(`mv${mv[2] === 'less' ? '<=' : '>='}${Number(mv[1])}` as Limit);
  const pw = phrase.match(/power (\d+) or (less|greater)/);
  if (pw) limits.push(`power${pw[2] === 'less' ? '<=' : '>='}${Number(pw[1])}` as Limit);
  const tg = phrase.match(/toughness (\d+) or (less|greater)/);
  if (tg) limits.push(`toughness${tg[2] === 'less' ? '<=' : '>='}${Number(tg[1])}` as Limit);
  if (
    /\bnon(?:white|blue|black|red|green)\b|\b(?:white|blue|black|red|green) (?:creature|permanent|spell)/.test(
      phrase
    )
  )
    limits.push('colour');
  if (/\battacking\b|\bblocking\b|\btapped creature\b|attacked or blocked/.test(phrase))
    limits.push('combat');
  if (/\bnontoken\b/.test(phrase)) limits.push('nontoken');
  else if (
    /\btokens?\b/.test(phrase) &&
    !/\bcreatures?\b|\bpermanents?\b/.test(phrase.replace(/tokens?/, ''))
  )
    limits.push('token-only');
  if (/\bexcept\b|\bother than\b/.test(phrase)) limits.push('except');
  if (/until cardname leaves the battlefield/.test(phrase)) limits.push('until-leaves');
  if (/until end of turn|until your next turn|next untap step/.test(phrase))
    limits.push('temporary');
  if (/unless its controller pays|unless that player pays/.test(phrase)) limits.push('unless-pays');
  return limits;
}

function scopeOf(quant: string | undefined): Scope {
  if (!quant) return 'single';
  if (/^(?:all|each)\b/.test(quant)) return 'mass';
  if (/up to one\b|^another\b|^one\b/.test(quant)) return 'single';
  return 'multi';
}

/** The zone change each action performs by default (origin, destination). */
const VERB_ZONES: Partial<Record<EffectVerb, [Zone | null, Zone | null]>> = {
  destroy: ['battlefield', 'graveyard'],
  exile: ['battlefield', 'exile'],
  bounce: ['battlefield', 'hand'],
  tuck: ['battlefield', 'library'],
  sacrifice: ['battlefield', 'graveyard'],
  steal: ['battlefield', 'battlefield'],
  counter: ['stack', 'graveyard'],
  'gy-hate': ['graveyard', 'exile'],
  draw: ['library', 'hand'],
  discard: ['hand', 'graveyard'],
  mill: ['library', 'graveyard'],
  dig: ['library', 'hand'],
  impulse: ['library', 'exile'],
  search: ['library', 'hand'],
  token: [null, 'battlefield'],
  regrow: ['graveyard', 'hand'],
  reanimate: ['graveyard', 'battlefield'],
  'cast-from-gy': ['graveyard', 'stack'],
  blink: ['battlefield', 'battlefield'],
  'land-to-battlefield': ['hand', 'battlefield'],
};

/** The zone change each trigger mode watches. */
const EVENT_ZONES: Partial<Record<TriggerEvent, [Zone | null, Zone | null]>> = {
  enters: [null, 'battlefield'],
  dies: ['battlefield', 'graveyard'],
  leaves: ['battlefield', null],
  sacrifice: ['battlefield', 'graveyard'],
  cast: [null, 'stack'],
  draw: ['library', 'hand'],
  discard: ['hand', 'graveyard'],
  cycle: ['hand', 'graveyard'],
  mill: ['library', 'graveyard'],
  'leave-graveyard': ['graveyard', null],
};

function trig(event: TriggerEvent, object: string, who: Polarity): TriggerSig {
  const [from, to] = EVENT_ZONES[event] ?? [null, null];
  return { event, from, to, object, who };
}

function eff(
  verb: EffectVerb,
  object: string,
  who: Polarity,
  extra: {
    amount?: number | 'X' | null;
    dest?: Zone | null;
    hits?: Hit[];
    scope?: Scope;
    limits?: Limit[];
  } = {}
): EffectSig {
  const [from, to] = VERB_ZONES[verb] ?? [null, null];
  return {
    verb,
    object,
    who,
    amount: extra.amount ?? null,
    from,
    to: extra.dest ?? to,
    hits: extra.hits ?? [],
    scope: extra.scope ?? 'single',
    limits: extra.limits ?? [],
  };
}

function objectOfHits(hits: Hit[]): string {
  return hits.length ? hits.join('|') : 'other';
}

/** Is this object phrase about the card's own side (a self-target, not removal)? */
function isOwnSide(phrase: string): boolean {
  return (
    /^(?:[a-z ]*?)\b(?:you control|you own)\b/.test(phrase) && !/you don'?t control/.test(phrase)
  );
}

/** Who a subject phrase ("each opponent", "target player") names. */
function subjectPolarity(subject: string | undefined): Polarity {
  if (!subject || /^you$/.test(subject)) return 'you';
  if (/opponent|defending player|its controller|their controller|each other player/.test(subject))
    return 'opp';
  if (/each player|all players/.test(subject)) return 'each';
  return 'any';
}

const SUBJECT =
  '(you|each player|target player|target opponent|each opponent|that player|an opponent|its controller|their controller|defending player|each other player|they)';

/** Every effect one sentence names. */
export function parseSentence(s: string, ctx: SentenceCtx): EffectSig[] {
  const out: EffectSig[] = [];
  const add = (e: EffectSig | null) => {
    if (e) out.push(e);
  };

  // Counterspells.
  for (const m of s.matchAll(
    /\bcounter (target|up to (?:one|two|three) targets?|all(?: other)?|each|that|it|the first)\b([^.]*)/g
  )) {
    if (m[1] === 'it' && !/spell|abilit/.test(ctx.abilityText)) continue;
    const phrase = m[1] === 'that' || m[1] === 'it' ? `${m[2]} spell` : m[2];
    const hits = spellHitsOf(phrase.trim() || 'spell');
    add(
      eff('counter', objectOfHits(hits), 'any', {
        hits,
        scope: /all|each/.test(m[1]) ? 'mass' : 'single',
        limits: limitsOf(m[2]),
      })
    );
  }
  // Mindbreak Trap: "exile any number of target spells".
  for (const m of s.matchAll(/\bexile (any number of |up to (?:one|two) )?target spells?\b/g)) {
    add(eff('counter', 'spell', 'any', { hits: ['spell'], scope: m[1] ? 'multi' : 'single' }));
  }

  // Graveyard hate.
  if (
    /\bexiles? (?:all cards from |all creature cards from |the top [^.]*? of )?(?:target player's|each opponent's|each player's|all|an opponent's|target opponent's|that player's) graveyards?\b/.test(
      s
    ) ||
    /\bexiles? (?:up to (?:one|two|three) )?(?:target |a )?(?:[a-z]+ )?cards? from (?:a|an opponent's|target player's|their|each opponent's|all) graveyards?\b/.test(
      s
    ) ||
    /would be put into (?:a|an opponent's) graveyard from anywhere[^.]*exile it instead/.test(s) ||
    /\bexile all graveyards\b/.test(s) ||
    /\bshuffles? [^.]*cards? from (?:target player's|each player's|each opponent's|all|an opponent's) graveyards? into\b/.test(
      s
    )
  ) {
    if (
      !/exiled this way onto the battlefield/.test(ctx.abilityText) &&
      !/from their graveyard[^.]*exiled/.test(s)
    )
      add(
        eff('gy-hate', 'card', polarityOf(s) === 'you' ? 'any' : 'opp', {
          scope: /\ball\b/.test(s) ? 'mass' : 'single',
        })
      );
  }

  // Destroy / exile, targeted.
  for (const m of s.matchAll(
    new RegExp(
      `\\b(destroy|exile) (up to (?:one|two|three|four|x|\\d+) |any number of |another |two |three |x |each of up to [a-z]+ )?(?:other )?targets? ([^.]*)`,
      'g'
    )
  )) {
    const phrase = clip(m[3]);
    if (
      /^(?:player|opponent)'?s? /.test(phrase) ||
      /\bcards?\b/.test(phrase.split(/ from /)[0]) ||
      /^spells?\b/.test(phrase)
    )
      continue;
    if (isOwnSide(phrase)) continue;
    if (
      /\breturn (?:it|them|that card|those cards|the exiled card|that permanent) to the battlefield/.test(
        ctx.abilityText
      ) &&
      m[1] === 'exile' &&
      !/until/.test(phrase)
    )
      continue; // blink
    const hits = hitsOf(phrase);
    if (!hits.length) continue;
    add(
      eff(m[1] as EffectVerb, objectOfHits(hits), polarityOf(phrase), {
        hits,
        scope: scopeOf(m[2]?.trim()),
        limits: limitsOf(m[3]),
      })
    );
  }
  // Destroy / exile, mass.
  for (const m of s.matchAll(/\b(destroy|exile) (all|each) ([^.]*)/g)) {
    const phrase = m[3];
    if (/graveyard|cards? from|spells?\b/.test(phrase.split(/ (?:and|then) /)[0])) continue;
    if (/^cardname\b/.test(phrase)) continue;
    const hits = massHits(phrase);
    if (!hits.length) continue;
    add(
      eff(m[1] as EffectVerb, objectOfHits(hits), massSide(phrase, s), {
        hits,
        scope: 'mass',
        limits: limitsOf(phrase),
      })
    );
  }

  // Bounce, targeted and mass.
  for (const m of s.matchAll(
    /\breturn (up to (?:one|two|three|x) |any number of |another |two |x )?(?:other )?targets? ([^.]*?) to (?:its|their) owner'?s?'? hands?/g
  )) {
    const phrase = m[2];
    // Returning a spell to its owner's hand is a counter (Hullbreaker Horror).
    if (/^spells?\b/.test(phrase)) {
      add(eff('counter', 'spell', polarityOf(phrase), { hits: ['spell'] }));
      continue;
    }
    if (/\bcards?\b/.test(phrase) || isOwnSide(phrase)) continue;
    const hits = hitsOf(phrase);
    if (hits.length)
      add(
        eff('bounce', objectOfHits(hits), polarityOf(phrase), {
          hits,
          scope: scopeOf(m[1]?.trim()),
          dest: 'hand',
          limits: limitsOf(phrase),
        })
      );
  }
  for (const m of s.matchAll(/\breturn (all|each) ([^.]*?) to (?:its|their) owner'?s?'? hands?/g)) {
    if (/\bcards?\b/.test(m[2])) continue;
    const hits = massHits(m[2]);
    if (hits.length)
      add(
        eff('bounce', objectOfHits(hits), massSide(m[2], s), {
          hits,
          scope: 'mass',
          dest: 'hand',
          limits: limitsOf(m[2]),
        })
      );
  }

  // Tuck.
  for (const m of s.matchAll(
    /\bput (?:up to (?:one|two) )?target ([^.]*?) (?:on (?:the )?(top|bottom) of|into) (?:its|their) owner'?s?'? librar/g
  )) {
    if (/\bcards?\b/.test(m[1])) continue;
    const hits = hitsOf(m[1]);
    if (hits.length)
      add(
        eff('tuck', objectOfHits(hits), polarityOf(m[1]), {
          hits,
          dest: m[2] === 'top' ? 'library-top' : 'library-bottom',
          limits: limitsOf(m[1]),
        })
      );
  }
  for (const m of s.matchAll(
    /\b(?:the owner of target ([^.]*?) shuffles it into|shuffle target ([^.]*?) into) (?:their|its owner's) library/g
  )) {
    const phrase = m[1] ?? m[2];
    const hits = hitsOf(phrase);
    if (hits.length)
      add(
        eff('tuck', objectOfHits(hits), polarityOf(phrase), {
          hits,
          dest: 'library-bottom',
          limits: limitsOf(phrase),
        })
      );
  }

  // Damage.
  for (const m of s.matchAll(
    /\bdeals? (\d+|x|that much|twice that much|damage equal to [^.]*?|an amount of damage equal to [^.]*?|damage) (?:damage )?(?:to|divided as you choose among) ([^.]*)/g
  )) {
    const amount = parseCount(m[1]);
    for (const e of damageEffects(m[2], amount)) add(e);
  }

  // Fight.
  for (const m of s.matchAll(/\bfights? (up to one |another )?target ([^.]*)/g)) {
    const phrase = clip(m[2]);
    const hits = hitsOf(phrase);
    add(
      eff('fight', objectOfHits(hits.length ? hits : ['creature']), polarityOf(phrase), {
        hits: hits.length ? hits : ['creature'],
      })
    );
  }

  // Shrink: -N/-N and -1/-1 counters.
  for (const m of s.matchAll(
    /\b(target|up to (?:one|two|three) target|another target) ([^.]*?)gets? -(\d+|x)\/-(\d+|x)/g
  )) {
    add(
      eff('shrink', 'creature', polarityOf(m[2]), {
        hits: ['creature'],
        scope: scopeOf(m[1].replace(/ ?target$/, '') || undefined),
        amount: parseCount(m[4]),
        limits: limitsOf(m[2]),
      })
    );
  }
  if (
    /\b(?:all |each )(?:other )?(?:[a-z]+ )*creatures?[^.]*?gets? -(?:\d+|x)\/-(?:\d+|x)|(?:^|[^t] )(?:other )?creatures?(?: [a-z' ]+)? get -(?:\d+|x)\/-(?:\d+|x)/.test(
      s
    ) &&
    !/\btarget\b[^.]*gets? -/.test(s)
  ) {
    const who =
      /you don'?t control|your opponents control|opponents control|an opponent controls/.test(s)
        ? 'opp'
        : 'each';
    add(eff('shrink', 'creature', who, { hits: ['creature'], scope: 'mass', limits: limitsOf(s) }));
  }
  for (const m of s.matchAll(
    new RegExp(
      `\\bput ${COUNT} -1\\/-1 counters? on (target|each|up to (?:one|two) target) ([^.]*)`,
      'g'
    )
  )) {
    const mass = m[1] === 'each';
    add(
      eff('shrink', 'creature', mass ? massSide(m[2], s) : polarityOf(m[2]), {
        hits: ['creature'],
        scope: mass ? 'mass' : 'single',
        limits: limitsOf(m[2]),
      })
    );
  }

  // Forced sacrifice (edicts), and your own sacrifices.
  for (const m of s.matchAll(
    new RegExp(
      `\\b${SUBJECT} (?:each )?sacrifices? (a|an|one|two|three|x|\\d+|that many|all|half|the rest)\\b([^.]*)`,
      'g'
    )
  )) {
    const who = subjectPolarity(m[1]);
    const phrase = m[3];
    const mass = m[2] === 'all' || m[2] === 'the rest' || m[2] === 'half';
    const hits =
      mass && m[2] === 'the rest'
        ? (['permanent'] as Hit[])
        : hitsOf(phrase.split(/ of (?:their|his or her) choice| they control/)[0] || 'creature');
    if (who === 'you') {
      add(eff('sacrifice', nounOf(phrase), 'you', { amount: parseCount(m[2]) }));
      continue;
    }
    if (!hits.length) continue;
    add(
      eff('sacrifice', objectOfHits(hits), who === 'any' ? 'opp' : who, {
        hits,
        scope: mass ? 'mass' : 'single',
        amount: parseCount(m[2]),
        limits: limitsOf(phrase),
      })
    );
  }
  // A subject carried through a "then" chain: Living Death's "Each player
  // exiles ..., then sacrifices all creatures they control, then ...".
  const lead = s.match(new RegExp(`^${SUBJECT}\\b`));
  if (lead && subjectPolarity(lead[1]) !== 'you') {
    for (const m of s.matchAll(
      /(?:, then| then|, and) sacrifices? (all|the rest|a|an|one|two|three|x)\b([^,.]*)/g
    )) {
      const who = subjectPolarity(lead[1]);
      const mass = m[1] === 'all' || m[1] === 'the rest';
      const hits =
        m[1] === 'the rest'
          ? (['permanent'] as Hit[])
          : hitsOf(m[2].split(/ of (?:their|his or her) choice| they control/)[0] || 'creature');
      if (hits.length)
        add(
          eff('sacrifice', objectOfHits(hits), who === 'any' ? 'opp' : who, {
            hits,
            scope: mass ? 'mass' : 'single',
          })
        );
    }
  }
  // An edict that exiles: "Target opponent exiles a creature or planeswalker
  // they control with the greatest mana value ..." (Blot Out). The player
  // exiles from their own board, so the object is a permanent they control.
  for (const m of s.matchAll(
    new RegExp(
      `\\b${SUBJECT} exiles? (a|an|one|two|three|x|\\d+) ([^.]*?)\\b(?:they|he or she) controls?\\b`,
      'g'
    )
  )) {
    const who = subjectPolarity(m[1]);
    // "Each player exiles ..." hits your own board too (Descent into Madness):
    // a symmetric tax, not an answer.
    if (who === 'you' || who === 'each') continue;
    const hits = hitsOf(m[3]);
    if (!hits.length) continue;
    add(
      eff('exile', objectOfHits(hits), who === 'any' ? 'opp' : who, {
        hits,
        scope: 'single',
        amount: parseCount(m[2]),
        limits: limitsOf(m[3]),
      })
    );
  }
  if (
    /\bchooses? [^.]*and sacrifices? the rest\b/.test(s) &&
    !out.some((e) => e.verb === 'sacrifice' && e.scope === 'mass')
  ) {
    const who = /each opponent/.test(s) ? 'opp' : 'each';
    add(eff('sacrifice', 'permanent', who, { hits: ['permanent'], scope: 'mass' }));
  }
  // Imperative "sacrifice a creature" as an effect (not a cost).
  for (const m of s.matchAll(
    /(?:^|, |then |and )(?:you may )?sacrifice (a|an|another|one|two|x|cardname|it)\b\s?([a-z]+)?/g
  )) {
    add(
      eff(
        'sacrifice',
        m[1] === 'cardname' || m[1] === 'it' ? 'self' : nounOf(m[2] ?? 'permanent'),
        m[1] === 'cardname' ? 'self' : 'you',
        { amount: parseCount(m[1]) }
      )
    );
  }

  // Steal.
  // "Exchange control of two target nonland permanents" swaps one of yours for one of theirs.
  const exchange = s.match(/\bexchange control of (?:two )?target ([^.]*?)(?: that share\b|$)/);
  if (exchange) {
    const hits = hitsOf(exchange[1]);
    if (hits.length) add(eff('steal', objectOfHits(hits), 'any', { hits }));
  }
  for (const m of s.matchAll(/\bgain control of (target|all|each|up to one target) ([^.]*)/g)) {
    const phrase = m[2];
    const hits = hitsOf(clip(phrase));
    if (!hits.length) continue;
    add(
      eff(
        'steal',
        objectOfHits(hits),
        m[1] === 'all' || m[1] === 'each' ? massSide(phrase, s) : polarityOf(phrase),
        {
          hits,
          scope: m[1] === 'all' || m[1] === 'each' ? 'mass' : 'single',
          limits: limitsOf(phrase),
        }
      )
    );
  }
  if (
    /\bgain control of them until end of turn\b/.test(s) &&
    /untap all creatures|all creatures target/.test(ctx.abilityText)
  ) {
    add(
      eff('steal', 'creature', 'opp', { hits: ['creature'], scope: 'mass', limits: ['temporary'] })
    );
  }
  const auraSteal = s.match(
    /\byou control enchanted (creature|permanent|artifact|land|planeswalker)\b/
  );
  if (auraSteal) add(eff('steal', auraSteal[1], 'any', { hits: hitsOf(auraSteal[1]) }));

  // Neutralize: Pacifism, Darksteel Mutation, Song of the Dryads, tap-locks.
  const neut = s.match(
    /\benchanted (creature|permanent|artifact|planeswalker)(?:'s activated abilities can't be activated| can't attack or block| can't attack| can't block| loses all(?: other)? abilities| is (?:a|an) [^.]*(?:loses all|with base power)| is a (?:colorless )?[a-z]+ land| doesn't untap)/
  );
  if (neut && ctx.face.isAura) add(eff('neutralize', neut[1], 'any', { hits: hitsOf(neut[1]) }));
  if (
    /\b(?:that creature|it|that permanent|target creature|those creatures)[^.]*(?:doesn't|don't) untap during (?:its|their) controller'?s?'? (?:next )?untap step/.test(
      s
    )
  ) {
    add(
      eff('neutralize', 'creature', polarityOf(ctx.abilityText), {
        hits: ['creature'],
        scope: /\bthose creatures\b/.test(s) ? 'multi' : 'single',
        limits: /next untap step/.test(s)
          ? ['temporary']
          : /for as long as/.test(s)
            ? ['until-leaves']
            : [],
      })
    );
  }

  // Static tap-locks on a whole class (Meekstone): "Creatures with power 3 or
  // greater don't untap during their controllers' untap steps."
  const massLock = s.match(
    /^((?:[a-z]+ )*(?:creatures|artifacts|permanents|lands)\b[^.]*?) (?:don't|doesn't) untap during their controllers'? untap steps?/
  );
  if (massLock && ctx.kind === 'static') {
    const hits = hitsOf(massLock[1]);
    if (hits.length)
      add(
        eff('neutralize', objectOfHits(hits), massSide(massLock[1], s), {
          hits,
          scope: 'mass',
          limits: limitsOf(massLock[1]),
        })
      );
  }
  // A triggered answer to "that creature" (Liliana's Talent: "Whenever a
  // creature deals damage to enchanted planeswalker, destroy that creature").
  const thatOne = s.match(/^(destroy|exile) that (creature|permanent)\b/);
  if (thatOne && ctx.kind === 'trigger')
    add(eff(thatOne[1] as EffectVerb, thatOne[2], 'any', { hits: hitsOf(thatOne[2]) }));

  // Tap (tempo).
  for (const m of s.matchAll(/\btap (target|up to (?:one|two|three) target|all|each) ([^.]*)/g)) {
    const phrase = clip(m[2]);
    const hits = hitsOf(phrase);
    if (hits.length && !isOwnSide(phrase))
      add(
        eff(
          'tap',
          objectOfHits(hits),
          m[1] === 'all' || m[1] === 'each' ? massSide(phrase, s) : polarityOf(phrase),
          { hits, scope: m[1] === 'all' || m[1] === 'each' ? 'mass' : 'single' }
        )
      );
  }

  // Draw.
  for (const m of s.matchAll(
    new RegExp(
      `(?:\\b${SUBJECT} (?:may )?)?\\bdraws? (a card for each [^,.]*|a card|an additional card|one card|two cards|three cards|four cards|five cards|six cards|seven cards|x cards|that many cards|cards equal to [^,.]*|(?:two|three|x) additional cards|\\w+ cards?)`,
      'g'
    )
  )) {
    if (/draw step/.test(m[2]) || /would $/.test(s.slice(Math.max(0, (m.index ?? 0) - 6), m.index)))
      continue;
    const who = subjectPolarity(m[1]);
    const n = m[2].match(/^(\w+)/)?.[1];
    const amount = /equal to|for each|that many/.test(m[2])
      ? 'X'
      : parseCount(n === 'an' ? 'a' : n);
    add(eff('draw', 'card', who, { amount }));
  }
  // Discard.
  for (const m of s.matchAll(
    new RegExp(
      `(?:\\b${SUBJECT} (?:may )?)?\\bdiscards? (a card|an? [a-z]+ card|one card|two cards|three cards|x cards|that many cards|(?:their|your|his or her) hand|all cards in (?:their|your) hand|up to [^,.]*|cards?|a nonland card|the rest)`,
      'g'
    )
  )) {
    if (/^(?:whenever|if)/.test(s) && !m[1]) continue;
    const who = subjectPolarity(m[1]);
    const hand = /hand$/.test(m[2]);
    add(
      eff('discard', hand ? 'hand' : 'card', who, {
        amount: hand ? 'X' : parseCount(m[2].split(' ')[0]),
      })
    );
  }
  // Mill.
  for (const m of s.matchAll(
    new RegExp(
      `(?:\\b${SUBJECT} )?\\bmills? (a card|\\w+ cards?|x cards|cards equal to [^,.]*|half [^,.]*)`,
      'g'
    )
  )) {
    add(eff('mill', 'card', subjectPolarity(m[1]), { amount: parseCount(m[2].split(' ')[0]) }));
  }
  // Scry / surveil.
  const scry = s.match(/\bscry (\d+|x)\b/);
  if (scry) add(eff('scry', 'card', 'you', { amount: parseCount(scry[1]) }));
  const surveil = s.match(/\bsurveil (\d+|x)\b/);
  if (surveil) add(eff('surveil', 'card', 'you', { amount: parseCount(surveil[1]) }));

  // Tutors.
  for (const m of s.matchAll(
    /\bsearch(?:es)? (your|their|target player's|its controller's|that player's|his or her) library( and\/or graveyard)? for ([^.]*)/g
  )) {
    const found = m[3];
    // Finale of Devastation: "search your library and/or graveyard" can
    // reanimate what it finds.
    if (m[2] && /onto the battlefield/.test(found))
      add(eff('reanimate', `card:${nounOf(found)}`, 'you', { dest: 'battlefield' }));
    // "Choose two target players. Each of them searches their library"
    // (Scheming Symmetry): the caster chooses themselves as one of them, so
    // it is a tutor for you (the other search is the price).
    const chosenPlayers =
      m[1] === 'their' &&
      /\beach of them searches\b/.test(s) &&
      /\btarget players\b/.test(ctx.abilityText.toLowerCase());
    const who: Polarity =
      m[1] === 'your' || chosenPlayers ? 'you' : m[1] === "target player's" ? 'any' : 'opp';
    // What it finds: up to the first "card(s)" ("a Plains, Island, Swamp, or
    // Mountain card"), else up to the first clause break.
    const what =
      found.match(/^[^.]*?\bcards?\b/)?.[0] ?? found.split(/,| and put| and reveal| then /)[0];
    // A card of a creature type or any other name-word ("a Ninja card",
    // Higure; "a Goblin card", Goblin Matron) is a narrow search, not "a card".
    const narrowed = /^(?:up to )?(?:a|an|one|two|three|x|\d+) (?!cards?\b)[a-z-]+ cards?$/.test(
      what.trim()
    );
    const object = /\bcards? named\b|with the same name/.test(found)
      ? 'named'
      : /\bbasic land|\bland cards?|\b(?:forest|plains|island|swamp|mountain|gate|desert) cards?|\bbasic (?:forest|plains|island|swamp|mountain)/.test(
            what
          )
        ? /\bbasic\b/.test(what)
          ? 'land:basic'
          : 'land'
        : /\bcreature\b/.test(what)
          ? 'creature'
          : /\b(?:artifact|equipment)\b/.test(what)
            ? 'artifact'
            : /\b(?:enchantment|aura)\b/.test(what)
              ? 'enchantment'
              : /\b(?:instant|sorcery)\b/.test(what)
                ? 'instant-sorcery'
                : /\bplaneswalker\b/.test(what)
                  ? 'planeswalker'
                  : /\bpermanent card\b/.test(what)
                    ? 'permanent'
                    : /\bcards?\b/.test(what) && !narrowed
                      ? 'any'
                      : 'other';
    const tail = found;
    const dest: Zone = /onto the battlefield/.test(tail)
      ? 'battlefield'
      : /into your graveyard/.test(tail)
        ? 'graveyard'
        : /on top\b|on top of (?:your|their) library/.test(tail)
          ? 'library-top'
          : 'hand';
    const amount = parseCount(what.match(/^(?:up to )?(\w+)/)?.[1]);
    add(
      eff('search', object, who, {
        dest,
        amount: amount === null && /^a|an\b/.test(what) ? 1 : amount,
      })
    );
  }

  // Mana.
  for (const m of s.matchAll(
    /(?:\b(its controller|that player|each player|they) )?\badds? ((?:\{[^}]+\})+|(?:one|two|three|four|five|x|that much|an amount of|that many|\w+) mana|(?:an amount of|x|that much|that many) \{[^}]+\}|an additional (?:\{[^}]+\}|one mana|mana|[a-z]+ mana))/g
  )) {
    const who = m[1] ? (m[1] === 'each player' ? 'each' : 'any') : 'you';
    const symbols = m[2].match(/\{[^}]+\}/g);
    // "Add {R} for each card in target opponent's hand" and "an amount of {C}
    // equal to" scale; a fixed "{B}{B}{B}" does not.
    const scales =
      /^(?:an amount of|x|that much|that many)\b/.test(m[2]) ||
      /^[^.]*?\b(?:for each|equal to)\b/.test(s.slice((m.index ?? 0) + m[0].length));
    const amount = scales ? 'X' : symbols ? symbols.length : parseCount(m[2].split(' ')[0]);
    add(eff('add-mana', /additional/.test(m[2]) ? 'mana:additional' : 'mana', who, { amount }));
  }
  if (/produces? twice as much|produces three times as much/.test(s))
    add(eff('add-mana', 'mana:additional', 'you'));

  // Tokens.
  if (/\bcreates?\b[^.]*\btokens?\b/.test(s)) {
    const tc = tokenCreation(s);
    const amount = parseCount(s.match(/\bcreates? (\w+)/)?.[1]);
    if (tc.creaturesForYou) add(eff('token', 'token:creature', 'you', { amount }));
    for (const k of tc.kinds)
      if (k !== 'creature')
        add(
          eff(
            'token',
            ['treasure', 'clue', 'food'].includes(k) ? `token:${k}` : 'token:other',
            'you',
            { amount }
          )
        );
    // A list of kinds before one "token" ("create a Clue, Food, or Treasure
    // token"): tokenCreation reads only the kind next to the noun.
    if (tc.noncreatureForYou) {
      const list = s.match(
        /\bcreates? (?:a|an|one|two|x|\d+)? ?((?:(?:treasure|clue|food)(?:,? (?:or|and) |, ))+(?:treasure|clue|food)) tokens?/
      );
      for (const k of list?.[1].match(/treasure|clue|food/g) ?? [])
        add(eff('token', `token:${k}`, 'you', { amount }));
    }
    if (!tc.creaturesForYou && !tc.noncreatureForYou) {
      const opp =
        /(?:its controller|that player|target opponent|each opponent|target player|each player|defending player|that opponent|each other player)[^.]*creates?/.test(
          s
        );
      if (opp)
        add(
          eff(
            'token',
            /\d+\/\d+|creature/.test(s) ? 'token:creature' : 'token:other',
            /each player/.test(s) ? 'each' : 'opp'
          )
        );
      else if (
        /\bcreates? [^.]*\b(?:artifact|enchantment|land|role|incubator|junk|map|shard|walker|gem|powerstone|blood|gold)\b[^.]*token/.test(
          s
        )
      )
        add(eff('token', 'token:other', 'you', { amount }));
    }
  }
  if (/\bincubate\b/.test(s)) add(eff('token', 'token:other', 'you'));
  if (/\binvestigates?\b/.test(s))
    add(
      eff(
        'token',
        'token:clue',
        /(?:that player|its controller|target player|each opponent|target opponent) investigates/.test(
          s
        )
          ? 'opp'
          : 'you'
      )
    );

  // Counters.
  for (const m of s.matchAll(
    new RegExp(`\\bputs? ${COUNT} (?:additional )?\\+1\\/\\+1 counters? on ([^.]*)`, 'g')
  )) {
    const phrase = m[1];
    const mass = /^(?:each|all)\b/.test(phrase);
    add(
      eff(
        'put-counter',
        'p1p1',
        /^cardname\b/.test(phrase) ? 'self' : mass ? massSide(phrase, s) : polarityOf(phrase),
        { scope: mass ? 'mass' : 'single' }
      )
    );
  }
  if (/enters with (?:\w+|x) (?:additional )?\+1\/\+1 counters?/.test(s))
    add(eff('put-counter', 'p1p1', 'self'));
  for (const m of s.matchAll(
    new RegExp(`\\bputs? ${COUNT} (?:additional )?([a-z]+) counters? on ([^.]*)`, 'g')
  )) {
    if (/^(?:lore|time)$/.test(m[1]) && /^cardname/.test(m[2])) continue;
    add(eff('put-counter', m[1], /^cardname\b/.test(m[2]) ? 'self' : polarityOf(m[2])));
  }
  if (/\bproliferate\b/.test(s)) add(eff('proliferate', 'counter', 'you'));
  // Player counters: "you get an experience counter" (Meren), "{E}" aside.
  const playerCounter = s.match(
    /\byou get (?:an?|one|two|three|x|\d+|that many) ([a-z]+) counters?/
  );
  if (playerCounter) add(eff('put-counter', playerCounter[1], 'you'));

  // Life.
  const gain = s.match(
    /\byou gain (\d+|x|that much|life equal to [^,.]*|\w+) life|\byou gain life equal to/
  );
  if (gain) add(eff('gain-life', 'life', 'you', { amount: parseCount(gain[1]) }));
  for (const m of s.matchAll(
    new RegExp(
      `\\b${SUBJECT} loses? (\\d+|x|that much|half (?:their|his or her) life|life equal to [^,.]*|\\w+) life`,
      'g'
    )
  )) {
    add(
      eff('lose-life', 'life', subjectPolarity(m[1]) === 'any' ? 'opp' : subjectPolarity(m[1]), {
        amount: /equal to|half|that much/.test(m[2]) ? 'X' : parseCount(m[2]),
      })
    );
  }

  // Recursion.
  for (const m of s.matchAll(
    /\b(return|put) ([^.]*?)\bcards? ([^.]*?)(?:from|in) (your|a|any|target player's|their|an opponent's|all|each player's) graveyards? (?:to|onto|into) (your hand|the battlefield|its owner's hand|their owners' hands|the top of your library|your library)/g
  )) {
    if (/\bcardname\b/.test(m[2])) continue;
    // "Sacrifice it unless you return a basic land card from your graveyard"
    // is a cost (Harvest Wurm), not recursion.
    if (/\bunless (?:you )?$/.test(s.slice(Math.max(0, (m.index ?? 0) - 12), m.index))) continue;
    const toBattlefield = /battlefield/.test(m[5]);
    const object = `card:${nounOf(m[2]) === 'card' ? 'any' : nounOf(m[2])}`;
    add(
      eff(
        toBattlefield ? 'reanimate' : 'regrow',
        object,
        m[4] === 'your' || m[4] === 'their' ? 'you' : 'any',
        {
          dest: toBattlefield ? 'battlefield' : /hand/.test(m[5]) ? 'hand' : 'library-top',
          scope: /\ball\b/.test(m[2]) ? 'mass' : 'single',
        }
      )
    );
  }
  if (/\breturn enchanted creature card to the battlefield/.test(s))
    add(eff('reanimate', 'card:creature', 'any', { dest: 'battlefield' }));
  if (/\bputs? (?:all )?(?:the )?cards? (?:they|you) exiled this way onto the battlefield/.test(s))
    add(eff('reanimate', 'card:creature', 'each', { dest: 'battlefield', scope: 'mass' }));
  if (
    /(?:in|from) your graveyard/.test(ctx.abilityText) &&
    !/\bexile\b[^.]*\breturn\b/.test(ctx.abilityText)
  ) {
    if (
      /\bput (?:it|that card) onto the battlefield/.test(s) ||
      /\breturn (?:the chosen cards|those cards|them|that card|it) to the battlefield/.test(s)
    )
      add(eff('reanimate', 'card:any', 'you', { dest: 'battlefield' }));
    if (
      /\bput (?:it|that card) into your hand/.test(s) ||
      /\breturn (?:the chosen cards|those cards|them|that card|it) to your hand/.test(s)
    )
      add(eff('regrow', 'card:any', 'you', { dest: 'hand' }));
  }
  const castGy = s.match(/\b(?:you may )?(?:cast|play) ([^.]*?) from your graveyard/);
  if (castGy && !/^cardname\b/.test(castGy[1]))
    add(
      eff('cast-from-gy', `card:${nounOf(castGy[1]) === 'card' ? 'any' : nounOf(castGy[1])}`, 'you')
    );
  if (
    /\bcards? in your graveyard gains? (?:flashback|escape|retrace)|gains flashback until end of turn/.test(
      s
    ) &&
    !/cardname gains/.test(s)
  )
    add(eff('cast-from-gy', 'card:instant-sorcery', 'you'));

  // Copy.
  const copySpell = s.match(
    /\bcopy (?:target|that|it|the next|each|a|any number of|the exiled card|cardname)\b([^.]*)/
  );
  if (
    copySpell &&
    (/spells?|abilit/.test(copySpell[1] + ctx.abilityText) ||
      /the exiled card|copy cardname/.test(s))
  )
    add(eff('copy', /abilit/.test(copySpell[1]) ? 'ability' : 'spell', 'any'));
  if (/\btokens? that(?:'s| are)(?: a)? cop(?:y|ies) of\b/.test(s))
    add(
      eff(
        'copy',
        'permanent',
        /copy of (?:target |a |another )?[^.]*you control|copy of cardname|copy of it\b|copy of equipped/.test(
          s
        )
          ? 'you'
          : 'any'
      )
    );

  // Untap.
  for (const m of s.matchAll(
    /\buntap (up to (?:one|two|three|four|five|x) |all |another |each )?(?:target )?(?:other )?(nonland permanents?|permanents?|lands?|creatures?|artifacts?|artifact or creature)\b([^.]*)/g
  )) {
    if (/\bgain control\b/.test(s)) break;
    // "Untap up to two lands" is a fixed refund; "untap all lands" scales.
    const upTo = m[1]?.match(/^up to (\w+)/)?.[1];
    add(
      eff(
        'untap',
        nounOf(m[2]),
        /you control/.test(m[3]) || /^lands?$/.test(m[2]) ? 'you' : 'any',
        {
          amount: upTo ? parseCount(upTo) : null,
          scope: /^(?:all|each)\b/.test(m[1] ?? '') ? 'mass' : 'single',
        }
      )
    );
  }
  if (/\buntap them\b/.test(s)) add(eff('untap', 'creature', 'you'));
  // A creature type in place of the card type: "Untap target Elf" (Wirewood Lodge).
  if (
    !out.some((e) => e.verb === 'untap') &&
    /\buntap (?:another |up to one )?target [a-z]+\b/.test(s) &&
    !/\bgain control\b/.test(s)
  )
    add(eff('untap', 'permanent', 'any'));

  // Turns, combats, the game.
  if (/\badditional combat phases?\b/.test(s)) add(eff('extra-combat', 'combat', 'you'));
  if (/\btakes? an extra turn\b/.test(s))
    add(eff('extra-turn', 'turn', /target player takes|that player takes/.test(s) ? 'any' : 'you'));
  if (/\byou win the game\b/.test(s)) add(eff('win', 'game', 'you'));
  const loses = s.match(
    /\b(each opponent|target player|target opponent|that player|each other player) loses the game\b/
  );
  if (loses) add(eff('lose-game', 'game', 'opp'));
  if (/\byou become the monarch\b/.test(s)) add(eff('monarch', 'monarch', 'you'));
  if (/\byou take the initiative\b/.test(s)) add(eff('initiative', 'initiative', 'you'));
  if (/\bgoad\b/.test(s)) add(eff('goad', 'creature', 'opp'));

  // Pump and grants.
  // The subject of "get +N/+N" is the nearest one before it in its clause
  // ("As long as cardname has seven or more quest counters on it, creatures
  // you control get +5/+5" pumps your creatures, not cardname).
  for (const m of s.matchAll(/\bgets? \+(\d+|x)\/\+(\d+|x)/g)) {
    const clause =
      s
        .slice(0, m.index)
        .split(/, (?!and\b|or\b)/)
        .pop() ?? '';
    const subj = clause.match(
      /(creatures you control|other creatures you control|each creature you control|all creatures you control|attacking creatures you control|creature tokens you control|other [a-z]+s you control|[a-z]+s you control|target creature(?: you control)?|up to (?:one|two) target creatures?|equipped creature|enchanted creature|cardname|all creatures|creatures)\b[^,]*$/
    )?.[1];
    if (!subj) continue;
    const mass = !/^(?:target|up to|equipped|enchanted|cardname)/.test(subj);
    add(
      eff(
        'pump',
        'creature',
        /^cardname$/.test(subj)
          ? 'self'
          : /you control|^equipped/.test(subj)
            ? 'you'
            : mass
              ? 'each'
              : 'any',
        { scope: mass ? 'mass' : 'single', amount: parseCount(m[1]), limits: limitsOf(s) }
      )
    );
  }
  const grant = s.match(
    /\b(creatures you control|other creatures you control|permanents you control|other permanents you control|each creature you control|legendary creatures you control|artifacts you control|target creature(?: you control)?|target permanent(?: you control)?|target artifact or creature you control|equipped creature|enchanted creature|cardname and other [a-z]+s you control|you and permanents you control|you and other permanents you control)\b[^.]*?\b(?:gains?|has|have)\b([^.]*)/
  );
  if (grant) {
    const subj = grant[1];
    const mass = /you control/.test(subj) && !/^target/.test(subj);
    // An Equipment's bearer, and a creature "you control", is yours; an
    // Aura's may be anyone's (Darksteel Mutation's indestructible is a cage).
    const who: Polarity = /^target (?:creature|permanent)$|^enchanted\b/.test(subj) ? 'any' : 'you';
    for (const kw of [
      'hexproof',
      'indestructible',
      'shroud',
      'protection',
      'flying',
      'trample',
      'haste',
      'lifelink',
      'deathtouch',
      'vigilance',
      'double strike',
      'first strike',
      'menace',
    ]) {
      if (!new RegExp(`\\b${kw}\\b`).test(grant[2])) continue;
      // "Protection from black and from green" guards against two colours;
      // "from the color of your choice" or "from everything" is real protection.
      const partial =
        kw === 'protection' &&
        !/protection from (?:the colou?r of your choice|everything|each colou?r|all colou?rs|each of the colou?rs)/.test(
          grant[2]
        );
      add(
        eff('grant', partial ? 'kw:protection-partial' : `kw:${kw.replace(' ', '-')}`, who, {
          scope: mass ? 'mass' : 'single',
          limits: limitsOf(s),
        })
      );
    }
  }

  // Cost reduction for spells you cast.
  const less = s.match(
    /\b((?:[a-z]+ )*?)spells?(?: you cast)?(?: [^.]*?)? costs? (?:\{[^}]+\}|\d+|x|up to \{[^}]+\})(?: generic mana)? less to cast/
  );
  if (
    less &&
    !/^(?:this|cardname)/.test(less[1].trim()) &&
    !/\bcardname costs\b/.test(s) &&
    !/\bthis spell\b/.test(s)
  ) {
    const kind = less[1].trim();
    add(
      eff(
        'cost-less',
        kind ? `spell:${kind.replace(/\s+/g, '-')}` : 'spell',
        /you cast/.test(s) ? 'you' : /opponents? cast/.test(s) ? 'opp' : 'each'
      )
    );
  }
  if (/\babilities you activate cost|equip abilities[^.]*cost [^.]*less/.test(s))
    add(eff('cost-less', 'ability', 'you'));

  // Lands.
  const extraLand = s.match(
    /\b(each player|you) may play (?:an|one|two|three|x|\w+) additional lands?|\bplay (?:an|two|three|x) additional lands?/
  );
  if (extraLand) add(eff('extra-land', 'land', extraLand[1] === 'each player' ? 'each' : 'you'));
  if (
    /\bput (?:a|up to (?:one|two|three)|any number of|x) (?:basic )?land cards? from your hand onto the battlefield/.test(
      s
    )
  )
    add(eff('land-to-battlefield', 'land', 'you'));

  // Misc.
  // Damage prevention or redirection for your own things (Vassal's Duty,
  // Caduceus's granted "Prevent all damage that would be dealt to this creature").
  if (
    /\bdamage that would be dealt to (?:target )?(?:[a-z]+ )*(?:creatures? you control|permanents? you control|cardname|this creature|you)\b/.test(
      s
    )
  )
    add(eff('prevent', 'damage', 'you'));
  if (/\bget (?:\w+ )?\{e\}|\byou get (?:that many|an amount of) \{e\}/.test(s))
    add(eff('energy', 'energy', 'you'));
  if (/\bprevent all (?:combat )?damage\b/.test(s)) add(eff('prevent', 'damage', 'each'));
  const phase = s.match(/\b([a-z ]+?) phases? out\b/);
  if (phase && !/cardname phases out/.test(s))
    add(
      eff(
        'phase-out',
        'permanent',
        // "Target creature you don't control phases out" (Teferi, Master of
        // Time) takes a blocker away; it protects nothing of yours.
        /\b(?:you don'?t control|an opponent controls)\b[^.]*\bphases? out\b/.test(s)
          ? 'opp'
          : /you control|^you\b/.test(phase[1])
            ? 'you'
            : 'any',
        { scope: /permanents|creatures/.test(phase[1]) ? 'mass' : 'single' }
      )
    );

  // "If you would ..., ... instead": a replacement that modifies other effects.
  if (/\bwould\b[^.]*\binstead\b/.test(s))
    for (const e of out) e.limits = [...e.limits, 'replacement'];
  return out;
}

/** Hits for a wipe's object phrase: expand "permanents" and honor carve-outs. */
function massHits(phrase: string): Hit[] {
  const head = phrase.split(/\bexcept (?:for )?|\bother than\b/)[0];
  const carve = phrase.split(/\bexcept (?:for )?|\bother than\b/)[1] ?? '';
  let hits = hitsOf(clip(head).replace(/\bwith [^.]*$/, ''));
  if (carve && (hits.includes('permanent') || hits.includes('nonland-permanent'))) {
    const all: Hit[] = hits.includes('nonland-permanent')
      ? ['creature', 'artifact', 'enchantment', 'planeswalker', 'battle']
      : ['creature', 'artifact', 'enchantment', 'planeswalker', 'land', 'battle'];
    const excluded = hitsOf(carve);
    hits = all.filter((h) => !excluded.includes(h));
    if (hits.length === 5 && !hits.includes('land')) hits = ['nonland-permanent'];
  }
  return hits;
}

/** A mass effect is one-sided when its object names the opponents' side. */
function massSide(phrase: string, sentence: string): Polarity {
  if (
    /you don'?t control|your opponents control|opponents control|an opponent controls|target player controls|that player controls|each opponent controls|defending player controls|they control/.test(
      phrase
    )
  )
    return 'opp';
  if (
    /^for each opponent/.test(sentence) ||
    /\beach opponent\b[^.]*\b(?:destroy|exile|sacrifices?)\b/.test(sentence)
  )
    return 'opp';
  if (/you control\b/.test(phrase) && !/don'?t/.test(phrase)) return 'you';
  // "All attacking creatures" with no controller named are the attacker's:
  // an instant-speed answer on an opponent's turn (Aetherize).
  if (/^(?:other )?attacking creatures\b/.test(phrase)) return 'opp';
  return 'each';
}

/** Damage recipients: permanents are interaction, players are reach. */
function damageEffects(recipients: string, amount: number | 'X' | null): EffectSig[] {
  const out: EffectSig[] = [];
  const r = recipients.split(
    /,? (?:and|then) (?:you|it|cardname|that|its|put|create|draw|gain)\b|\. /
  )[0];
  if (
    /\bany target\b|\bany number of targets\b|\bone or two targets\b|\bup to (?:one|two|three) targets\b|\bamong (?:any number of|one or two|two|three) targets\b/.test(
      r
    )
  ) {
    const multi = /any number|one or two|two|three/.test(r);
    out.push(
      eff('damage', 'creature|planeswalker|battle', 'any', {
        hits: ['creature', 'planeswalker', 'battle'],
        scope: multi ? 'multi' : 'single',
        amount,
      })
    );
    out.push(eff('damage', 'player', 'any', { amount }));
    return out;
  }
  const massPart = r.match(
    /\beach (?:other )?(?:creature|nonland|non-?[a-z]+ creature|creature and planeswalker|creature and each planeswalker|planeswalker|permanent|creature without flying|creature with flying|[a-z]+ creature)[^.]*/
  );
  if (massPart) {
    const hits = hitsOf(massPart[0].replace(/\beach player\b|\beach opponent\b/g, ''));
    const side =
      /each opponent and each/.test(r) ||
      /they control|you don'?t control|your opponents control|opponents control/.test(massPart[0])
        ? 'opp'
        : 'each';
    if (hits.length)
      out.push(
        eff('damage', objectOfHits(hits), side, {
          hits,
          scope: 'mass',
          amount,
          limits: limitsOf(massPart[0]),
        })
      );
  }
  const target = r.match(
    /\b(target|another target|up to (?:one|two|three) target|any number of target|each of up to (?:one|two|three) target|two target|x target)s? ([^,.]*)/
  );
  if (target && !/^(?:player|opponent)s?\b/.test(target[2])) {
    const phrase = clip(target[2]);
    const hits = hitsOf(phrase.replace(/\bplayer\b|\bopponent\b/g, ''));
    if (hits.length && !isOwnSide(phrase))
      out.push(
        eff('damage', objectOfHits(hits), polarityOf(phrase), {
          hits,
          scope: scopeOf(target[1].replace(/ ?target$/, '') || undefined),
          amount,
          limits: limitsOf(phrase),
        })
      );
  }
  if (/\beach opponent\b/.test(r)) out.push(eff('damage', 'player', 'opp', { amount }));
  else if (/\beach player\b/.test(r)) out.push(eff('damage', 'player', 'each', { amount }));
  else if (
    /\btarget (?:player|opponent)\b|\bthat player\b|\bdefending player\b/.test(r) &&
    !out.some((e) => e.object === 'player')
  )
    out.push(eff('damage', 'player', 'opp', { amount }));
  return out;
}

/** Effects that span sentences: blink, dig, impulse, overload. */
function parseAbilityLevel(text: string): EffectSig[] {
  const out: EffectSig[] = [];
  const blink = text.match(
    /\bexile (another target|target|up to (?:one|two) target|two target|any number of target|all|each)? ?([^.]*?)(?:, then return|\. return|, return| and return| then return)[^.]*?\b(?:it|them|that card|those cards|the exiled cards?|that permanent)\b[^.]*?to the battlefield/
  );
  if (
    blink &&
    !/transformed|front face up/.test(text) &&
    !/from (?:your|a|their|its owner's) graveyard/.test(blink[0])
  ) {
    const phrase = blink[2];
    if (!/^cardname\b/.test(phrase)) {
      const hits = hitsOf(phrase);
      out.push(
        eff(
          'blink',
          objectOfHits(hits.length ? hits : ['permanent']),
          /you control/.test(phrase) ? 'you' : 'any',
          { scope: /^all|^each/.test(blink[1] ?? '') ? 'mass' : 'single' }
        )
      );
    }
  }
  const dig = text.match(/\b(?:look at|reveal) the top (?:(\w+) )?cards? of your library/);
  if (dig && /into your hand/.test(text) && !/\bexile the top\b/.test(text))
    out.push(eff('dig', 'card', 'you', { amount: parseCount(dig[1] ?? 'one') }));
  const impulse = text.match(/\bexile the top (\w+ )?cards? of your library/);
  if (impulse && /\byou may (?:play|cast)\b/.test(text))
    out.push(eff('impulse', 'card', 'you', { amount: parseCount(impulse[1]?.trim() ?? 'one') }));
  // Oracle of Mul Daya, Future Sight: playing off the top is card advantage.
  if (
    /\byou may (?:play|cast) [^.]*?from the top of your library\b|\byou may (?:play|cast) the top card of your library\b/.test(
      text
    )
  )
    out.push(eff('impulse', 'card', 'you', { amount: null }));
  // Seed of Hope: "put a permanent card from among the milled cards into your hand".
  if (
    !dig &&
    /\bput [^.]*\bfrom among (?:them|those cards|the milled cards|the revealed cards|the exiled cards)\b[^.]*into your hand/.test(
      text
    )
  )
    out.push(eff('dig', 'card', 'you', { amount: 1 }));
  // Recross the Paths: "reveal cards ... until you reveal a land card. Put that card onto the battlefield".
  if (
    /\buntil you reveal (?:a|an) (?:basic )?land card\b/.test(text) &&
    /\bput (?:that card|it) onto the battlefield/.test(text)
  )
    out.push(eff('land-to-battlefield', 'land', 'you', { dest: 'battlefield' }));
  // Anikthea: exile a card from your graveyard, then make a token copy of it.
  // Recursion of the card's effect, but the card itself stays exiled.
  if (
    /from your graveyard/.test(text) &&
    /\btoken that'?s a copy of (?:that card|it|the exiled card)\b/.test(text)
  )
    out.push(eff('reanimate', 'card:token-copy', 'you', { dest: 'battlefield' }));
  // Estrid's Invocation: "enter as a copy of".
  if (/\benter as a copy of\b/.test(text)) out.push(eff('copy', 'permanent', 'you'));
  return out;
}
