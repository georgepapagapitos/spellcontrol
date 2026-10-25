import type { AiGeneration } from './client';
import type { DeckFacts } from './facts-sheet';
import { FIXES_MARK, WEAKNESS_MARK } from './deck-review';

/**
 * The post-write check on the review's WEAKNESS paragraph (E1020).
 *
 * The facts sheet (v15) did not stop the review from inventing its weakness: it
 * moved the false claims to the ones the sheet does not state outright ("lacks
 * cheap interaction" beside Swords to Plowshares, "very few creatures" beside
 * 22). So the paragraph is read against the same computed facts, mechanically,
 * after it is written.
 *
 * Code only, no second model call: a claim is a pattern ("no sweeper", "lacks
 * cheap removal", "X is not in the list") and the contradiction is a count or a
 * name on the sheet. That is the part why-check learned the hard way (the
 * checker never rewrites a line, the code decides), minus the model.
 *
 * The failure path is one constrained regeneration: the model is told which
 * sentence the app's own count contradicts and asked for a different weakness
 * or for "the deck is sound". If the second draft is also contradicted, the
 * contradicted sentences are cut from it. A paragraph with nothing left ships
 * as written and is counted, so the miss is visible.
 *
 * Streaming: the weakness is the first section, so the hold only delays the
 * first words by the length of one paragraph; everything after it streams
 * straight through.
 */

export interface Contradiction {
  sentence: string;
  /** The sheet fact that contradicts it, worded for the correction note. */
  fact: string;
}

const NEG =
  "(?:no|zero|lacks?|lacking|without|missing|not a single|nothing|doesn't (?:run|have|play|include)|does not (?:run|have|play|include)|has no|have no|runs? no|never runs?)";
// "almost no", "virtually nothing": scarcity, not the absolute claim the sheet can refute.
const HEDGE = '(?<!almost |virtually |nearly |hardly |practically )';
// A qualified claim ("cannot reliably answer", "no instant-speed answer except X")
// is a different claim from "has none"; the count does not refute it.
const QUALIFIED =
  /\b(?:except|other than|besides|apart from|aside from|short of|beyond|reliably|consistently|cheaply|efficiently|at instant speed|quickly|early|in time|on its own|alone)\b/i;
const SCARCE = '(?:few|little|short on|not enough|too few|light on|low on|barely any)';

const list = (names: string[]) => names.slice(0, 6).join(', ');

interface Rule {
  /** The claim names its own qualifier ('cheap', 'instant-speed'); QUALIFIED does not skip it. */
  qualifiedOk?: boolean;
  re: RegExp;
  /** The fact, or null when the sheet does not contradict this match. */
  fact: (facts: DeckFacts, m: RegExpMatchArray) => string | null;
}

const roleRule = (noun: string, label: string, pick: (f: DeckFacts) => string[]): Rule => ({
  re: new RegExp(`${HEDGE}\\b${NEG}\\s+(?:[\\w-]+\\s+){0,2}?(?:${noun})\\b`, 'i'),
  fact: (f) => {
    const names = pick(f);
    return names.length > 0 ? `${label} (${names.length}): ${list(names)}` : null;
  },
});

const RULES: Rule[] = [
  roleRule(
    'sweepers?|board ?wipes?|wraths?(?! of)|mass removal|mass-removal',
    'Sweepers',
    (f) => f.roles.sweeper
  ),
  roleRule('counterspells?|counter magic', 'Counterspells', (f) => f.roles.counter),
  roleRule('ramp|mana rocks?|mana dorks?|mana accelerat\\w+', 'Ramp', (f) => f.roles.ramp),
  roleRule('card draw|draw engines?|draw spells?', 'Card draw', (f) => f.roles.draw),
  roleRule('spot removal|targeted removal', 'Spot removal', (f) => f.roles.spot),
  roleRule(
    'protection|protect(?:s|ing)? (?:your )?(?:commander|creatures)',
    'Protection',
    (f) => f.roles.protect
  ),
  {
    // "no removal", "lacks any real removal": generic only; a qualified claim
    // ("no removal for enchantments") belongs to the target rule below.
    re: new RegExp(
      `\\b${NEG}\\s+(?:any\\s+|real\\s+|meaningful\\s+|actual\\s+)?(?:removal|interaction)\\b(?!\\s+(?:that|for|to|which|at|in|beyond|outside|aside|besides|other))`,
      'i'
    ),
    fact: (f) =>
      f.roles.spot.length > 0
        ? `Spot removal (${f.roles.spot.length}): ${list(f.roles.spot)}`
        : null,
  },
  {
    re: new RegExp(
      `${HEDGE}\\b(?:${NEG}|can(?:'|no)t (?:answer|deal with|touch|remove|handle|interact with))\\s+(?:[\\w-]+\\s+){0,5}?(artifacts?|enchantments?|planeswalkers?|graveyards?)\\b`,
      'i'
    ),
    fact: (f, m) => {
      const key = m[1].toLowerCase().replace(/s$/, '') as keyof DeckFacts['answers'];
      const names = f.answers[key] ?? [];
      return names.length > 0 ? `Answers to ${key}: ${list(names)}` : null;
    },
  },
  {
    re: new RegExp(`\\b(?:${NEG}|${SCARCE})\\s+(?:real\\s+)?creatures\\b`, 'i'),
    // 15+ creatures is not "few"; the Statistics block shows the same count.
    fact: (f) => (f.creatureCount >= 15 ? `The deck runs ${f.creatureCount} creatures` : null),
  },
  {
    qualifiedOk: true,
    re: new RegExp(
      `\\b(${NEG}|${SCARCE})\\s+(?:any\\s+)?(cheap|inexpensive|low-cost|early|efficient|instant-speed|instant|one-mana|two-mana|1-mana|2-mana)\\s+(?:\\w+\\s+)?(?:interaction|removal|answers?)\\b`,
      'i'
    ),
    fact: (f, m) => {
      const names = /instant/i.test(m[2]) ? f.instantRemoval : f.cheapRemoval;
      const absolute = new RegExp(`^${NEG}$`, 'i').test(m[1]);
      if (names.length === 0 || (!absolute && names.length < 3)) return null;
      return `${/instant/i.test(m[2]) ? 'Instant-speed' : 'Cheap (mana value 2 or less)'} removal (${names.length}): ${list(names)}`;
    },
  },
];

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** "Krenko is not in the list": a card the deck runs, said to be missing from it. */
function missingCardRule(facts: DeckFacts, sentence: string): string | null {
  for (const name of facts.deckNames) {
    const faces = name.split(' // ');
    const spellings = [
      name,
      ...faces,
      ...faces.flatMap((f) => (f.includes(', ') ? [f.slice(0, f.indexOf(', '))] : [])),
    ].filter((s) => s.length >= 4);
    for (const s of spellings) {
      const re = new RegExp(
        `(?<![\\w'])${escapeRegExp(s)}(?![\\w'])[^.;]{0,40}?\\b(?:is not in|isn't in|are not in|aren't in|is missing from|missing from|absent from|is absent|does not appear|doesn't appear|is nowhere in|not in)\\b`,
        'i'
      );
      if (re.test(sentence)) return `${name} is in the decklist`;
    }
  }
  return null;
}

const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s+/).filter(Boolean);

/** Sentences of the weakness paragraph that the sheet's facts contradict. */
export function checkWeakness(weakness: string, facts: DeckFacts): Contradiction[] {
  const out: Contradiction[] = [];
  for (const sentence of sentencesOf(weakness)) {
    let fact: string | null = missingCardRule(facts, sentence);
    for (const rule of RULES) {
      if (fact) break;
      if (QUALIFIED.test(sentence) && !rule.qualifiedOk) continue;
      const m = sentence.match(rule.re);
      if (m) fact = rule.fact(facts, m);
    }
    if (fact) out.push({ sentence, fact });
  }
  return out;
}

/** The weakness section of a (possibly partial) review, without its label. */
export function weaknessOf(text: string): string {
  const start = text.indexOf(WEAKNESS_MARK);
  if (start === -1) return '';
  const body = text.slice(start + WEAKNESS_MARK.length);
  const end = body.indexOf(FIXES_MARK);
  return (end === -1 ? body : body.slice(0, end)).trim();
}

/** The user-message note for the one regeneration. */
export function correctionNote(found: Contradiction[]): string {
  const lines = found.map(
    (c) => `- You wrote: "${c.sentence}"\n  The app's own count says: ${c.fact}`
  );
  return (
    '## Correction (from the app)\n\n' +
    "A draft of this review made the claim(s) below, and the app's own count of the decklist contradicts them. " +
    'Do not make these claims. Write the review again with a different weakness that survives the list, or say the deck is sound in that respect and name its closest pressure point. ' +
    'Do not mention this note or the earlier draft.\n\n' +
    lines.join('\n')
  );
}

export interface ReviewCheckReport {
  /** Contradicted sentences in the first draft. */
  caught: Contradiction[];
  regenerated: boolean;
  /** Contradicted sentences cut from the second draft. */
  stripped: Contradiction[];
  /** The second draft was still contradicted and nothing could be cut. */
  shippedContradicted: boolean;
}

/**
 * Holds the stream until the weakness section is complete, then checks it.
 * `rejected` means the draft is discarded; with `strip`, contradicted
 * sentences are removed instead and the rest streams on.
 */
function createHold(
  facts: DeckFacts,
  send: (text: string) => void,
  strip: boolean,
  abort: () => void
) {
  let chunks: string[] = [];
  let state: 'pending' | 'open' | 'rejected' = 'pending';
  let emitted = '';
  let found: Contradiction[] = [];
  let cut: Contradiction[] = [];
  let unshippable = false;
  const out = (t: string) => {
    emitted += t;
    send(t);
  };
  const decide = () => {
    const buffer = chunks.join('');
    found = checkWeakness(weaknessOf(buffer), facts);
    if (found.length === 0) {
      state = 'open';
      // Replay the chunks as they arrived: the client sees the same deltas.
      for (const c of chunks) out(c);
    } else if (!strip) {
      state = 'rejected';
      abort();
    } else {
      let text = buffer;
      for (const c of found) text = text.replace(c.sentence, '').replace(/ {2,}/g, ' ');
      // Everything cut: ship the draft as written rather than an empty section.
      if (weaknessOf(text) === '') {
        unshippable = true;
        text = buffer;
      } else cut = found;
      state = 'open';
      out(text);
    }
    chunks = [];
  };
  return {
    onDelta(t: string) {
      if (state === 'open') return out(t);
      if (state === 'rejected') return;
      chunks.push(t);
      if (chunks.join('').includes(FIXES_MARK)) decide();
    },
    /** A write that failed mid-stream: the reader sees what was streamed, as before the check. */
    flushPending() {
      if (state !== 'pending') return;
      state = 'open';
      for (const c of chunks) out(c);
      chunks = [];
    },
    finish() {
      if (state === 'pending') decide();
    },
    get rejected() {
      return state === 'rejected';
    },
    get found() {
      return found;
    },
    get cut() {
      return cut;
    },
    get unshippable() {
      return unshippable;
    },
    get emitted() {
      return emitted;
    },
  };
}

/**
 * Write the review with the check around it. `write` is one writing pass
 * (`generateReview` bound to the prompt, model and gate options); the route and
 * the eval probe both call this, so what is measured is what ships.
 */
export async function writeCheckedReview(opts: {
  write: (user: string, onDelta: (t: string) => void, signal: AbortSignal) => Promise<AiGeneration>;
  user: string;
  facts: DeckFacts | null;
  send: (text: string) => void;
  signal?: AbortSignal;
}): Promise<{ generation: AiGeneration; report: ReviewCheckReport }> {
  const { write, user, facts, send, signal } = opts;
  const report: ReviewCheckReport = {
    caught: [],
    regenerated: false,
    stripped: [],
    shippedContradicted: false,
  };
  const attempt = async (userMessage: string, strip: boolean) => {
    const inner = new AbortController();
    const relay = () => inner.abort();
    signal?.addEventListener('abort', relay);
    const hold = createHold(facts!, send, strip, () => inner.abort());
    try {
      const generation = await write(userMessage, hold.onDelta, inner.signal);
      hold.finish();
      return { hold, generation: hold.rejected ? null : generation };
    } catch (err) {
      // The abort is ours when the hold rejected the draft; anything else is real.
      if (hold.rejected) return { hold, generation: null };
      hold.flushPending();
      throw err;
    } finally {
      signal?.removeEventListener('abort', relay);
    }
  };

  if (!facts) {
    const generation = await write(user, send, signal ?? new AbortController().signal);
    return { generation, report };
  }

  const first = await attempt(user, false);
  if (first.generation) return { generation: first.generation, report };

  report.caught = first.hold.found;
  report.regenerated = true;
  const second = await attempt(`${user}\n\n${correctionNote(first.hold.found)}`, true);
  const generation = second.generation!;
  report.stripped = second.hold.cut;
  report.shippedContradicted = second.hold.unshippable;
  // What the reader saw is the stored text, including any cut sentences.
  if (second.hold.cut.length > 0) generation.content = second.hold.emitted;
  return { generation, report };
}
