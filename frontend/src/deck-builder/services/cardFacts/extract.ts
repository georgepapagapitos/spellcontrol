/**
 * extractCardFacts: one Scryfall card → one CardFacts record (schema.ts).
 *
 * The (trigger, effects) tuples from parse.ts are the primary structure; every
 * role, interaction fact and extended resource flow below is derived from them
 * and points back at its ability by index. Axis flows come from the axis
 * predicates in synergy/axes.ts (so they reproduce classifyCard exactly) and
 * are attributed to the ability whose own text trips the predicate.
 *
 * Pure and deterministic: the same card and tags give the same record.
 */
import { AXES } from '../synergy/axes';
import { parseCard } from '../synergy/text';
import { classifyCard } from '../synergy/classify';
import { isProtectionPiece } from '../tagger/client';
import { isRampByTags } from '@spellcontrol/deck-metrics';
import {
  AXIS_RESOURCE,
  TIERS,
  type CardFacts,
  type EffectSig,
  type FactRole,
  type FactsInputCard,
  type FlowFact,
  type Hit,
  type InteractionFact,
  type Limit,
  type Resource,
  type RoleFact,
  type RoleSub,
  type Side,
  type Speed,
  type Tier,
} from './schema';
import { facesOf, splitAbilities, type FaceCtx, type ParsedAbility } from './parse';
import { computeStrengths } from './functions';

const PARSER_CONF = 0.8;
const AGREED_CONF = 0.95;
const TAG_ONLY_CONF = 0.35;

const INTERACTION_VERBS = new Set([
  'destroy',
  'exile',
  'bounce',
  'tuck',
  'damage',
  'shrink',
  'sacrifice',
  'steal',
  'fight',
  'counter',
  'neutralize',
]);
const NONLAND_HITS = new Set<Hit>([
  'creature',
  'artifact',
  'enchantment',
  'planeswalker',
  'battle',
  'nonland-permanent',
  'permanent',
]);
const PROTECTIVE_KEYWORDS = new Set([
  'kw:hexproof',
  'kw:indestructible',
  'kw:shroud',
  'kw:protection',
]);

/** Which tagger tags speak for each fact role (corroboration only). */
const ROLE_TAGS: Record<FactRole, (has: (t: string) => boolean) => boolean> = {
  ramp: (has) => isRampByTags(has),
  cardDraw: (has) => ['draw', 'card-advantage', 'cantrip', 'wheel'].some(has),
  tutor: (has) => has('tutor') && !has('land-tutor'),
  removal: (has) => has('removal') || has('spot-removal') || has('bounce'),
  counterspell: (has) => has('counterspell'),
  boardwipe: (has) => has('boardwipe'),
  protection: (has) => has('protection'),
  // No tagger bucket covers these two; they come from text alone.
  recursion: () => false,
  finisher: () => false,
  graveyardHate: (has) => has('graveyard-hate'),
};

interface Candidate {
  role: FactRole;
  sub: RoleSub | null;
  ability: number;
  sentence: number;
  /** A tier the rule forces regardless of rank (a rider, a cantrip, tempo). */
  force: Tier | null;
  /** The most a rule allows (loot and dig are selection, never primary). */
  cap: Tier | null;
  limits: Limit[];
}

const tierRank = (t: Tier) => TIERS.indexOf(t);
const worse = (a: Tier, b: Tier) => (tierRank(a) >= tierRank(b) ? a : b);
const down = (t: Tier): Tier => (t === 'primary' ? 'secondary' : 'incidental');

function sideOf(who: EffectSig['who']): Side {
  return who === 'opp' ? 'opponents' : who === 'each' ? 'all' : 'any';
}

// ── Roles ───────────────────────────────────────────────────────────────────

function roleCandidates(
  a: ParsedAbility,
  index: number,
  face: FaceCtx,
  all: ParsedAbility[]
): Candidate[] {
  const out: Candidate[] = [];
  const push = (
    c: Omit<Candidate, 'ability' | 'limits' | 'force' | 'cap'> &
      Partial<Pick<Candidate, 'force' | 'cap' | 'limits'>>
  ) => out.push({ ability: index, force: null, cap: null, limits: [], ...c });
  const oneShot = a.kind === 'spell' || a.repeat === 'once';
  const firstInteraction = a.effects.findIndex(
    (e) => INTERACTION_VERBS.has(e.verb) && e.who !== 'you' && e.who !== 'self'
  );
  // Mana from an Equipment's or Aura's combat trigger is a side effect of
  // attacking with the bearer (Sword of Feast and Famine), not a ramp piece.
  const combatTrigger = a.trigger?.event === 'combat-damage' && a.trigger.object === 'equipped';
  // A rider: an effect after this ability's first role-bearing one, in a
  // one-shot (Deadly Dispute's Treasure, Mana Drain's mana).
  let firstRoleEffect = -1;

  a.effects.forEach((e, j) => {
    const sentence = a.effectSentence[j];
    const afterInteraction =
      oneShot &&
      firstInteraction >= 0 &&
      j > firstInteraction &&
      a.effectSentence[firstInteraction] < sentence;
    const before = out.length;
    const rider = oneShot && firstRoleEffect >= 0 && firstRoleEffect < j;
    // "If you would ..., instead ..." multiplies other cards' effects
    // (Academy Manufactor); it is not a source of cards or mana itself.
    const replacement = e.limits.includes('replacement');

    if (INTERACTION_VERBS.has(e.verb)) {
      if (e.verb === 'counter') {
        push({ role: 'counterspell', sub: null, sentence, limits: e.limits });
      } else if (
        e.who !== 'you' &&
        e.who !== 'self' &&
        !(e.verb === 'damage' && e.object === 'player')
      ) {
        const nonland = e.hits.some((h) => NONLAND_HITS.has(h));
        const temporary = e.limits.includes('temporary');
        if (e.verb === 'steal' && temporary) {
          // A Threaten is a finisher at most (below), never removal.
        } else if (e.scope === 'mass') {
          // Overload costs a premium; a 1-damage or -1/-1 sweep only clears x/1s.
          const weak = (e.verb === 'damage' || e.verb === 'shrink') && e.amount === 1;
          // A mass tap-lock (Meekstone) is stax, not a wipe.
          const stax = e.verb === 'neutralize' || e.verb === 'tap';
          if (nonland && !stax)
            push({
              role: 'boardwipe',
              sub: null,
              sentence,
              limits: e.limits,
              cap: e.limits.includes('overload') || weak ? 'secondary' : null,
            });
        } else if (e.hits.length) {
          const sub: RoleSub =
            e.verb === 'bounce' ? 'bounce' : e.verb === 'sacrifice' ? 'edict' : 'spot';
          push({
            role: 'removal',
            sub,
            sentence,
            force: !nonland || temporary ? 'incidental' : null,
            limits: e.limits,
          });
        }
      }
    } else {
      switch (e.verb) {
        case 'gy-hate':
          push({ role: 'graveyardHate', sub: null, sentence });
          break;
        case 'draw': {
          if (e.who === 'opp' || replacement) break;
          const discardsHand = a.effects.some((x) => x.verb === 'discard' && x.object === 'hand');
          const loots = a.effects.some((x, k) => x.verb === 'discard' && x.who === 'you' && k > j);
          const sub: RoleSub = discardsHand
            ? 'wheel'
            : loots
              ? 'loot'
              : e.who === 'each'
                ? 'group'
                : e.amount === 1 && oneShot
                  ? 'cantrip'
                  : 'draw';
          let force: Tier | null = null;
          let cap: Tier | null = null;
          if (e.amount === 1 && oneShot) {
            // A lone cantrip spell (Opt, Ponder) is card selection; a draw-one
            // rider on anything else (Charge Through's trample, Skyshroud
            // Blessing's shroud), or on a permanent's ETB, is incidental. Read
            // the sentences, not just the parsed effects: the other half of a
            // cantrip is often an effect no role cares about.
            const others =
              a.effects.some(
                (x) => x !== e && !['draw', 'scry', 'surveil', 'discard'].includes(x.verb)
              ) ||
              a.sentences.some(
                (s, k) =>
                  k !== sentence &&
                  !/\b(?:scry|surveil|shuffle|look at|top [^.]*library|draw)\b/.test(s)
              );
            // Another line of the same spell that isn't library selection.
            const siblings = all.some(
              (x) =>
                x !== a &&
                x.face === a.face &&
                x.sentences.some(
                  (s) => !/\b(?:scry|surveil|shuffle|look at|top [^.]*library|draw)\b/.test(s)
                )
            );
            force = a.kind !== 'spell' || others || siblings ? 'incidental' : null;
            cap = 'secondary';
          }
          // Looting two (Faithless Looting) is selection; drawing X and then
          // discarding (Greater Good) is draw.
          if (sub === 'loot' && e.amount !== 'X') cap = 'secondary';
          if ((afterInteraction || rider) && e.amount === 1) force = 'incidental';
          push({ role: 'cardDraw', sub, sentence, force, cap });
          break;
        }
        case 'dig': {
          // A one-shot that keeps a single card (Impulse) is selection; a pile
          // (Fact or Fiction) or a repeating engine (Dark Confidant) is draw.
          const putsOne =
            /\bput (?:one|a card|that card|it|one of them)(?: of (?:them|those cards))? into your hand/.test(
              a.text
            );
          push({
            role: 'cardDraw',
            sub: 'dig',
            sentence,
            cap: oneShot && putsOne ? 'secondary' : null,
          });
          break;
        }
        case 'impulse':
          push({
            role: 'cardDraw',
            sub: 'impulse',
            sentence,
            cap: e.amount === 1 && oneShot ? 'secondary' : null,
          });
          break;
        case 'monarch':
          push({ role: 'cardDraw', sub: 'monarch', sentence });
          break;
        case 'token':
          if (replacement || e.who !== 'you') break;
          if (e.object === 'token:clue')
            push({ role: 'cardDraw', sub: 'clue', sentence, cap: oneShot ? 'secondary' : null });
          if (e.object === 'token:treasure' && !face.isLand)
            push({
              role: 'ramp',
              sub: 'treasure',
              sentence,
              // One Treasure from a one-shot is a rider (Deadly Dispute,
              // Reckless Ransacking); X of them, or one every turn, is ramp.
              force:
                afterInteraction || combatTrigger || (oneShot && e.amount === 1)
                  ? 'incidental'
                  : null,
            });
          break;
        case 'regrow':
          if (e.who === 'opp') break;
          push({ role: 'recursion', sub: 'to-hand', sentence });
          if (
            a.repeat !== 'once' ||
            e.scope === 'mass' ||
            (typeof e.amount === 'number' && e.amount >= 2)
          )
            push({ role: 'cardDraw', sub: 'gy-to-hand', sentence });
          break;
        case 'reanimate':
          // Finale of Devastation may find its creature in the graveyard: an
          // option of the tutor, not a reanimation spell.
          push({
            role: 'recursion',
            sub: 'to-battlefield',
            sentence,
            cap: a.effects.some((x) => x.verb === 'search') ? 'secondary' : null,
          });
          break;
        case 'cast-from-gy':
          push({ role: 'recursion', sub: 'cast-from-gy', sentence });
          break;
        case 'search': {
          if (e.who !== 'you' || e.object === 'named') break;
          if (e.object === 'land' || e.object === 'land:basic') {
            if (e.to === 'battlefield') {
              if (!face.isLand)
                push({
                  role: 'ramp',
                  sub: 'land',
                  sentence,
                  force: afterInteraction ? 'incidental' : null,
                });
            } else if (!a.effects.some((x) => x.verb === 'search' && x.to === 'battlefield')) {
              // A land tutor to hand fixes; it is not the consistency a tutor slot buys.
              push({ role: 'tutor', sub: 'land-card', sentence, force: 'incidental' });
            }
            break;
          }
          const sub =
            (
              [
                'any',
                'creature',
                'artifact',
                'enchantment',
                'instant-sorcery',
                'planeswalker',
                'permanent',
              ] as const
            ).find((s) => s === e.object) ?? 'other';
          // A search behind a cost nobody pays in a game (Vexing Puzzlebox's
          // hundred charge counters) is not a tutor slot; one behind a combat
          // hit (Higure, the Still Wind) is a sometimes tutor.
          const hugeCounterCost =
            /\bremove (?:\d{2,}|one hundred|fifty|twenty) [^.:]*counters?\b/.test(
              a.raw.toLowerCase()
            );
          push({
            role: 'tutor',
            sub,
            sentence,
            force: hugeCounterCost ? 'incidental' : null,
            cap: a.trigger?.event === 'combat-damage' ? 'secondary' : null,
          });
          break;
        }
        case 'add-mana': {
          if (face.isLand || replacement) break;
          const sub: RoleSub =
            e.object === 'mana:additional'
              ? 'doubler'
              : a.kind === 'spell'
                ? 'ritual'
                : face.isCreature
                  ? 'dork'
                  : face.isArtifact
                    ? 'rock'
                    : 'mana';
          push({
            role: 'ramp',
            sub,
            sentence,
            force: afterInteraction || combatTrigger ? 'incidental' : null,
            // A fixed ritual (Dark Ritual) is a burst; one that scales
            // (Jeska's Will: {R} per card in hand) is real ramp.
            cap: sub === 'ritual' && e.amount !== 'X' ? 'secondary' : null,
          });
          break;
        }
        case 'extra-land':
          if (e.who !== 'opp' && !face.isLand) push({ role: 'ramp', sub: 'extra-land', sentence });
          break;
        case 'land-to-battlefield':
          if (!face.isLand) push({ role: 'ramp', sub: 'land', sentence });
          break;
        case 'cost-less':
          if (e.who === 'you' && e.object.startsWith('spell') && !face.isLand)
            push({ role: 'ramp', sub: 'cost-reducer', sentence });
          break;
        case 'untap':
          // "Untap up to two lands" refunds a spell (Snap, Teferi); "untap all
          // lands you control" is a mana engine.
          if (e.object === 'land' && e.who === 'you' && !face.isLand)
            push({
              role: 'ramp',
              sub: 'untap',
              sentence,
              force: afterInteraction || combatTrigger || e.amount !== null ? 'incidental' : null,
            });
          break;
        case 'grant':
          if (e.who === 'opp') break;
          // Indestructible on a creature an Aura also shuts down is part of the
          // cage (Darksteel Mutation), not protection.
          if (e.who === 'any' && a.effects.some((x) => x.verb === 'neutralize')) break;
          if (PROTECTIVE_KEYWORDS.has(e.object)) push({ role: 'protection', sub: null, sentence });
          if (e.object === 'kw:protection-partial')
            push({ role: 'protection', sub: null, sentence, force: 'incidental' });
          break;
        case 'phase-out':
          if (e.who === 'you') push({ role: 'protection', sub: null, sentence });
          break;
        case 'win':
        case 'lose-game':
          // Winning the game is always the point of the card that says so.
          push({ role: 'finisher', sub: 'alt-win', sentence, force: 'primary' });
          break;
        case 'pump': {
          const big =
            e.amount === 'X' ||
            (typeof e.amount === 'number' && e.amount >= (e.limits.includes('temporary') ? 2 : 3));
          if (e.scope === 'mass' && e.who !== 'opp' && big)
            push({ role: 'finisher', sub: 'overrun', sentence });
          break;
        }
        case 'extra-combat':
          push({ role: 'finisher', sub: 'extra-combat', sentence });
          break;
        case 'extra-turn': {
          // An extra turn closes games the way an extra combat does, but only
          // yours: "take an extra turn" (Temporal Trespass) or "target player
          // takes" (Time Warp, cast on yourself). The parser reads any other
          // subject as yours too, so the text decides: an opponent's turn
          // (Eon Frolicker, Emrakul's "that player") or a contest's winner
          // (Timesifter) is not a finisher.
          const raw = a.raw.toLowerCase();
          const othersTurn =
            /\b(?:target opponent|each opponent|an opponent|that player|the player who)\b[^.]*\btakes? an extra turn\b/.test(
              raw
            );
          const yours = e.who === 'you' || /\btarget player takes? an extra turn\b/.test(raw);
          if (yours && !othersTurn) push({ role: 'finisher', sub: 'extra-turn', sentence });
          break;
        }
        case 'lose-life':
          // An X spell that drains (Exsanguinate). An X that counts something
          // on the board (Jovial Evil) is not a finisher.
          if (e.who === 'opp' && e.amount === 'X' && a.repeat === 'once' && face.xCost)
            push({ role: 'finisher', sub: 'drain', sentence });
          break;
        case 'prevent':
          if (e.who === 'you') push({ role: 'protection', sub: null, sentence });
          break;
        default:
          break;
      }
    }
    // Mass damage to each opponent for X, and a temporary mass steal (Insurrection).
    if (
      e.verb === 'damage' &&
      e.object === 'player' &&
      e.who === 'opp' &&
      e.amount === 'X' &&
      a.repeat === 'once' &&
      face.xCost
    )
      push({ role: 'finisher', sub: 'drain', sentence });
    if (e.verb === 'steal' && e.scope === 'mass' && e.limits.includes('temporary'))
      push({ role: 'finisher', sub: 'mass-steal', sentence });
    if (out.length > before && firstRoleEffect < 0) firstRoleEffect = j;
  });

  // The tagger client's protection classifier covers free redirects and
  // "can't be countered" grants the tuples don't express. A free counterspell
  // trips it too (Fierce Guardianship), but that is counterspell, not protection.
  // Phasing out a creature you don't control (Teferi, Master of Time's -3)
  // trips it too, and protects nothing of yours.
  if (
    !out.some((c) => c.role === 'protection' || c.role === 'counterspell') &&
    !a.effects.some((e) => e.verb === 'phase-out' && e.who === 'opp') &&
    isProtectionPiece({ name: '', oracle_text: a.raw })
  )
    push({ role: 'protection', sub: null, sentence: 0 });
  return out;
}

function roleFacts(
  card: FactsInputCard,
  faces: FaceCtx[],
  abilities: ParsedAbility[],
  tags: ReadonlySet<string>
): RoleFact[] {
  const perAbility = abilities.map((a, i) => roleCandidates(a, i, faces[a.face], abilities));
  // Rank: the first role-bearing ability on a face is its main job. The modes
  // of one modal spell share a rank.
  const rankOf = new Map<number, number>();
  for (const face of faces) {
    let rank = 0;
    const seenGroups = new Map<number, number>();
    abilities.forEach((a, i) => {
      if (a.face !== face.index || perAbility[i].length === 0) return;
      if (a.modalGroup >= 0 && seenGroups.has(a.modalGroup)) {
        rankOf.set(i, seenGroups.get(a.modalGroup)!);
        return;
      }
      rankOf.set(i, rank);
      if (a.modalGroup >= 0) seenGroups.set(a.modalGroup, rank);
      rank++;
    });
  }

  const best = new Map<FactRole, RoleFact>();
  abilities.forEach((a, i) => {
    const face = faces[a.face];
    const firstSentenceRoles = new Set(
      perAbility[i].filter((c) => c.sentence === 0).map((c) => c.role)
    );
    for (const c of perAbility[i]) {
      let tier: Tier = (rankOf.get(i) ?? 0) === 0 ? 'primary' : 'secondary';
      if (a.modalGroup >= 0) {
        const modes = abilities.filter((x) => x.modalGroup === a.modalGroup && x.face === a.face);
        const withRole = modes.filter((x) =>
          perAbility[abilities.indexOf(x)].some((y) => y.role === c.role)
        ).length;
        if (withRole * 2 < modes.length) tier = worse(tier, 'secondary');
      }
      if (c.sentence > 0 && firstSentenceRoles.size > 0 && !firstSentenceRoles.has(c.role))
        tier = down(tier);
      if (c.force) tier = c.force;
      if (c.cap) tier = worse(tier, c.cap);
      if (a.limits.includes('ultimate')) tier = 'incidental';
      // A transformed back face is reached only by flipping the card: its
      // facts are recorded, never counted. A prepare spell is cast again and
      // again, but only after the creature is prepared.
      if (a.limits.includes('transform')) tier = 'incidental';
      if (a.limits.includes('prepare')) tier = down(tier);
      if (face.isLand) tier = worse(tier, 'secondary');
      const agreed = ROLE_TAGS[c.role]((t) => tags.has(t));
      const fact: RoleFact = {
        role: c.role,
        tier,
        sub: c.sub,
        ability: i,
        face: a.face,
        speed: a.speed,
        repeat: a.repeat,
        limits: [...new Set([...a.limits, ...c.limits])],
        conf: agreed ? AGREED_CONF : PARSER_CONF,
        src: agreed ? ['parser', 'tag'] : ['parser'],
      };
      const prev = best.get(c.role);
      if (!prev || tierRank(fact.tier) < tierRank(prev.tier)) best.set(c.role, fact);
    }
  });

  // Transmute: a keyword tutor with no text of its own (reminder only).
  if ((card.keywords ?? []).some((k) => k.toLowerCase() === 'transmute') && !best.has('tutor')) {
    best.set('tutor', {
      role: 'tutor',
      tier: 'secondary',
      sub: 'any',
      ability: -1,
      face: 0,
      speed: 'sorcery',
      repeat: 'once',
      limits: [],
      conf: PARSER_CONF,
      src: ['parser'],
    });
  }

  // Tag claims with no text behind them: recorded, never counted.
  const fallbackSpeed: Speed = faces[0].isInstant
    ? 'instant'
    : faces[0].isSpell
      ? 'sorcery'
      : 'static';
  for (const role of Object.keys(ROLE_TAGS) as FactRole[]) {
    if (best.has(role) || !ROLE_TAGS[role]((t) => tags.has(t))) continue;
    best.set(role, {
      role,
      tier: 'incidental',
      sub: null,
      ability: -1,
      face: 0,
      speed: fallbackSpeed,
      repeat: 'once',
      limits: [],
      conf: TAG_ONLY_CONF,
      src: ['tag'],
    });
  }
  return [...best.values()].sort(
    (a, b) =>
      tierRank(a.tier) - tierRank(b.tier) || a.ability - b.ability || a.role.localeCompare(b.role)
  );
}

// ── Interaction ─────────────────────────────────────────────────────────────

function interactionFacts(abilities: ParsedAbility[]): InteractionFact[] {
  const out: InteractionFact[] = [];
  abilities.forEach((a, i) => {
    for (const e of a.effects) {
      if (!INTERACTION_VERBS.has(e.verb)) continue;
      if (e.verb !== 'counter' && (e.who === 'you' || e.who === 'self')) continue;
      if (e.verb === 'damage' && e.object === 'player') continue;
      // A Threaten borrows a creature for a turn; it answers nothing.
      if (e.verb === 'steal' && e.limits.includes('temporary')) continue;
      if (!e.hits.length) continue;
      out.push({
        mode: e.verb as InteractionFact['mode'],
        hits: e.hits,
        scope: e.scope,
        side: sideOf(e.who),
        ability: i,
        face: a.face,
        speed: a.speed,
        repeat: a.repeat,
        limits: [...new Set([...a.limits, ...e.limits])],
        conf: PARSER_CONF,
        src: ['parser'],
      });
    }
  });
  return out;
}

// ── Flows ───────────────────────────────────────────────────────────────────

function producedResources(e: EffectSig): Resource[] {
  if (e.who === 'opp') return [];
  switch (e.verb) {
    case 'add-mana':
      return ['mana'];
    case 'token':
      return e.object === 'token:treasure'
        ? ['treasure']
        : e.object === 'token:clue'
          ? ['clue']
          : e.object === 'token:food'
            ? ['food']
            : e.object === 'token:other'
              ? ['other-token']
              : [];
    case 'draw':
    case 'dig':
    case 'impulse':
      return ['cards'];
    case 'regrow':
      return ['gy-to-hand'];
    case 'reanimate':
      return e.object === 'card:token-copy' ? [] : ['gy-to-battlefield'];
    case 'put-counter':
      return e.object === 'p1p1' || e.object === 'loyalty' || e.object === 'lore'
        ? []
        : ['other-counter'];
    case 'proliferate':
      return ['other-counter'];
    case 'copy':
      return ['copy'];
    case 'untap':
      return ['untap'];
    case 'extra-combat':
      return ['extra-combat'];
    default:
      return [];
  }
}

function paidResources(a: ParsedAbility): Resource[] {
  // Spending a token as a cost rewards having it (Professional Face-Breaker).
  const spent: Resource[] = [];
  for (const c of a.cost) {
    if (c === 'sac:treasure') spent.push('treasure');
    if (c === 'sac:food') spent.push('food');
    if (c === 'sac:clue') spent.push('clue');
  }
  const t = a.trigger;
  if (!t) return spent;
  // A two-event trigger ("Whenever this creature enters or attacks") pays off
  // attacking as well as its first event.
  const alsoAttacks =
    t.event !== 'attacks' && /^whenever [^,]*\bor attacks\b/i.test(a.raw)
      ? ['attack' as const]
      : [];
  return [...spent, ...triggerResources(t), ...alsoAttacks];
}

function triggerResources(t: NonNullable<ParsedAbility['trigger']>): Resource[] {
  const mine = t.who === 'you' || t.who === 'self';
  switch (t.event) {
    case 'cast':
      if (t.who === 'opp') return [];
      return t.object === 'spell:noncreature'
        ? ['cast-noncreature']
        : t.object === 'spell:creature'
          ? ['cast-creature']
          : [];
    case 'draw':
      return t.who === 'you' ? ['cards'] : [];
    case 'attacks':
    case 'combat-damage':
      return mine ? ['attack'] : [];
    case 'leaves':
      // Its own departure is how a card cleans up (Oblivion Ring), not a payoff.
      return t.who === 'you' || t.who === 'any' ? ['ltb'] : [];
    case 'tapped-for-mana':
      // An Aura's own land being tapped is a mana source, not a payoff.
      return t.who === 'you' || t.who === 'each' ? ['mana'] : [];
    case 'sacrifice':
      return t.object === 'token:treasure'
        ? ['treasure']
        : t.object === 'token:food'
          ? ['food']
          : t.object === 'token:clue'
            ? ['clue']
            : [];
    default:
      return [];
  }
}

/**
 * "Whenever a creature (you control) dies", "whenever this creature or another
 * creature dies", "whenever you sacrifice a creature", "whenever equipped
 * creature dies": a creature of yours dying is rewarded. The object must be a
 * plain creature noun: "a creature an opponent controls" and "a creature with
 * a bounty counter on it" are someone else's deaths.
 */
const CREATURE_DEATH_PAYOFF =
  /\bwhenever (?:(?:this creature|cardname) or )?(?:a|another|one or more)(?: other)? (?:nontoken )?creatures?(?: you control)? (?:dies|die)\b|\bwhenever you sacrifice (?:a|another|one or more) (?:nontoken )?creatures?\b|\bwhenever (?:equipped|enchanted) creature dies\b/;

function flowFacts(
  card: FactsInputCard,
  faces: FaceCtx[],
  abilities: ParsedAbility[]
): { produces: FlowFact[]; payoffs: FlowFact[] } {
  const produces = new Map<Resource, FlowFact>();
  const payoffs = new Map<Resource, FlowFact>();
  const put = (map: Map<Resource, FlowFact>, r: Resource, ability: number) => {
    if (map.has(r)) return;
    const a = abilities[ability];
    map.set(r, {
      r,
      ability,
      face: a ? a.face : 0,
      repeat: a ? a.repeat : 'static',
      conf: PARSER_CONF,
      src: ['parser'],
    });
  };
  abilities.forEach((a, i) => {
    for (const e of a.effects) for (const r of producedResources(e)) put(produces, r, i);
    for (const r of paidResources(a)) put(payoffs, r, i);
    // creature-death: a creature of yours dying rewards the card, and
    // sacrificing a creature makes one die. The trigger's own words decide
    // (a creature with a bounty counter, an opponent's creature, and a
    // Treasure sacrificed are not it).
    if (CREATURE_DEATH_PAYOFF.test(a.raw.toLowerCase())) put(payoffs, 'creature-death', i);
    if (
      a.cost.includes('sac:creature') ||
      a.effects.some(
        (e) =>
          e.verb === 'sacrifice' &&
          e.object.split('|').includes('creature') &&
          (e.who === 'you' || e.who === 'each')
      )
    )
      put(produces, 'creature-death', i);
  });

  // Axis resources: presence exactly as classifyCard reads the card, then
  // attributed to the first ability whose own text trips the same predicate.
  const synergy = classifyCard(card);
  const keywords = card.keywords ?? [];
  const perAbility = abilities.map((a) =>
    parseCard({ name: card.name, type_line: faces[a.face].typeLine, oracle_text: a.raw, keywords })
  );
  for (const [list, dir] of [
    [synergy.producers, 'producer'],
    [synergy.payoffs, 'payoff'],
  ] as const) {
    for (const { axis } of list) {
      const def = AXES.find((x) => x.key === axis)!;
      const at = perAbility.findIndex((p) => def[dir](p) !== null);
      const map = dir === 'producer' ? produces : payoffs;
      const r = AXIS_RESOURCE[axis];
      if (map.has(r)) continue;
      if (at >= 0) put(map, r, at);
      else
        map.set(r, {
          r,
          ability: -1,
          face: 0,
          repeat: 'static',
          conf: PARSER_CONF,
          src: ['parser'],
        });
    }
  }
  const order = (m: Map<Resource, FlowFact>) =>
    [...m.values()].sort((x, y) => x.r.localeCompare(y.r));
  return { produces: order(produces), payoffs: order(payoffs) };
}

// ── Assembly ────────────────────────────────────────────────────────────────

const CARD_TYPES = [
  'artifact',
  'battle',
  'creature',
  'enchantment',
  'instant',
  'kindred',
  'land',
  'planeswalker',
  'sorcery',
];

/** Overload rewrites "target" to "each": add the mass reading of a spell's spot effects. */
function applyOverload(card: FactsInputCard, abilities: ParsedAbility[]): void {
  if (!(card.keywords ?? []).some((k) => k.toLowerCase() === 'overload')) return;
  for (const a of abilities) {
    if (a.kind !== 'spell') continue;
    const extra: EffectSig[] = [];
    const extraSentence: number[] = [];
    a.effects.forEach((e, j) => {
      if (!INTERACTION_VERBS.has(e.verb) || e.scope !== 'single' || e.verb === 'counter') return;
      extra.push({
        ...e,
        scope: 'mass',
        who: e.who === 'opp' ? 'opp' : 'each',
        limits: [...e.limits, 'overload'],
      });
      extraSentence.push(a.effectSentence[j]);
    });
    a.effects.push(...extra);
    a.effectSentence.push(...extraSentence);
  }
}

export function extractCardFacts(card: FactsInputCard, tags: Iterable<string> = []): CardFacts {
  const faces = facesOf(card);
  const abilities = faces.flatMap((f) => splitAbilities(card, f));
  applyOverload(card, abilities);
  const tagSet = new Set(tags);
  const typeText = faces.map((f) => f.typeLine).join(' ');
  const { produces, payoffs } = flowFacts(card, faces, abilities);
  const types = CARD_TYPES.filter((t) => new RegExp(`\\b${t}\\b`).test(typeText));
  const keywords = [...new Set((card.keywords ?? []).map((k) => k.toLowerCase()))].sort();
  const front = card.card_faces?.[0] ?? card;
  const num = (v: string | undefined) => (v !== undefined && /^-?\d+$/.test(v) ? Number(v) : null);
  const pt: CardFacts['pt'] =
    front.power === undefined && front.toughness === undefined
      ? null
      : [num(front.power), num(front.toughness)];
  const roles = roleFacts(card, faces, abilities, tagSet);
  const interaction = interactionFacts(abilities);
  return {
    oracleId: card.oracle_id,
    name: card.name,
    layout: card.layout ?? 'normal',
    types,
    keywords,
    pt,
    mv: typeof card.cmc === 'number' ? card.cmc : null,
    abilities: abilities.map((a) => ({
      face: a.face,
      kind: a.kind,
      speed: a.speed,
      repeat: a.repeat,
      cost: a.cost,
      trigger: a.trigger,
      effects: a.effects,
      limits: a.limits,
      modal: a.modal,
      loyalty: a.loyalty,
    })),
    roles,
    interaction,
    produces,
    payoffs,
    strengths: computeStrengths({ abilities, roles, interaction, produces, types, keywords, pt }),
  };
}
