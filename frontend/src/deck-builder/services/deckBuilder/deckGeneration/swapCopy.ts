// E513: a whole-deck swap, in the words a deck builder uses.
//
// The build report already titles each swap "Out → In", so the body does not
// repeat it: one sentence for why the card that came in, and, when the record
// has one, one for why the card that left was the weaker pick (a cost it
// carried, a crowded slot, a play rate below the newcomer's). The objective's
// per-card notes are written for the search's own logs ("answer #4 (0.7)",
// "1.93 price doublings", "screw 12% by turn 3"), so each shape is restated
// here as a clause. The wording is the only thing changed: the search never
// reads these strings.
import type { SwapReason } from '../deckObjective/swapReasons';

const pct = (n: string) => `${Math.round(Number(n))}%`;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "A, B, C and 6 more": at most three names, then how many are left. */
export function nameList(names: readonly string[], max = 3): string {
  // A name with its own comma ("Tekuthal, Inquiry Dominus") would read as two:
  // semicolons separate the list then.
  const sep = names.slice(0, max).some((n) => n.includes(',')) ? '; ' : ', ';
  if (names.length <= max) {
    return names.length > 1
      ? `${names.slice(0, -1).join(sep)} and ${names[names.length - 1]}`
      : names.join('');
  }
  return `${names.slice(0, max).join(sep)} and ${names.length - max} more`;
}

/** The names a note lists: whole when the term sent them, else read off the note. */
function listed(r: SwapReason, fromNote: string): string[] {
  if (r.names?.length) return r.names;
  return fromNote
    .replace(/ and \d+ more$/, '')
    .split(/, (?=[A-Z])/)
    .filter(Boolean);
}

type Clause = (m: RegExpMatchArray, r: SwapReason) => string | null;

function castable(p: number, turn: string): string {
  if (turn === '0') return 'costs nothing to cast';
  return p >= 85
    ? `is usually castable by turn ${turn}`
    : `is castable by turn ${turn} in about ${Math.round(p)}% of games`;
}

/** Why a card is wanted: a clause that follows the card's name. */
const WHY_IN: ReadonlyArray<[RegExp, Clause]> = [
  [/^([\d.]+)% of this page's decks/, (m) => `is in ${pct(m[1])} of this commander's decks`],
  [/^answer #\d+: (.+?) \([\d.]+\)$/, (m) => `adds an ${m[1].split(' ')[0]}-speed answer`],
  [
    /^draw engine #\d+: draws (on every trigger|continuously|every turn)/,
    (m) => `draws extra cards ${m[1] === 'continuously' ? 'all game' : m[1]}`,
  ],
  [
    /^protection #\d+ \([\d.]+\): keeps the commander on the battlefield$/,
    () => 'keeps the commander on the battlefield',
  ],
  [/^protection #\d+ /, () => 'protects the deck'],
  [/^tutor #\d+: finds (.+?) \([\d.]+\)$/, (m) => `is a tutor that finds ${m[1]}`],
  [/^castable on curve ([\d.]+)% \(turn (\d+)\)$/, (m) => castable(Number(m[1]), m[2])],
  [/^commander on curve /, () => 'helps the commander come down on time'],
  [/^land base: /, () => 'smooths out the mana'],
  [/^lifted by (.+)$/, (m, r) => `is played more often alongside ${nameList(listed(r, m[1]), 2)}`],
  [
    /^pays off (.+?) \(payoff \d+ of \d+\), fed by (.+)$/,
    (m, r) => `pays off the deck's ${m[1]} theme (fed by ${nameList(listed(r, m[2]))})`,
  ],
  [/^feeds (.+)$/, (m) => `feeds ${m[1]}`],
  [/^piece of (.+?) \(\d+ decks/, (m) => `is part of the ${m[1]} combo`],
  [
    /^plays [\d.]+ strength over its colors$/,
    () => 'is played more than its colors usually are here',
  ],
  [/^finisher: .*turns 1-(\d+)$/, (m) => `gives the deck a way to win by turn ${m[1]}`],
  [/^win-combo piece: .*turns 1-(\d+)$/, (m) => `is part of a combo that wins by turn ${m[1]}`],
  [/^you own it$/, () => 'is already in your collection'],
];

/** What a card that left had cost the deck (a penalty its going lifts). */
const COST_OUT: ReadonlyArray<[RegExp, Clause]> = [
  [/^buy for ([\d.]+ \w+): /, (m) => `would have cost ${m[1]} to buy`],
  [/^(.+?) phase is heavy/, () => 'sat in a part of the curve that was already crowded'],
];

function clauseFor(table: ReadonlyArray<[RegExp, Clause]>, r: SwapReason): string | null {
  for (const [re, make] of table) {
    const m = r.note.match(re);
    if (m) return make(m, r);
  }
  return null;
}

/** "draw from 12 to 11 (aiming for 9)" for each count a swap moved. */
function countsClause(note: string): string | null {
  const m = note.match(/^roles: (.+)$/);
  if (!m) return null;
  const moves = [...m[1].matchAll(/(\w[\w ]*?) (\d+) → (\d+) of target (\d+)/g)].map(
    (x) => `${x[1]} from ${x[2]} to ${x[3]} (aiming for ${x[4]})`
  );
  return moves.length ? `moves the deck's ${moves.join(' and ')}` : null;
}

const inclusion = (r: SwapReason) => {
  const m = r.note.match(/^([\d.]+)% of this page's decks/);
  return m ? Number(m[1]) : null;
};

/**
 * The swap as one or two short sentences: why the card that came in (its two
 * strongest reasons), and why the one that left was the weaker pick, when the
 * record has a reason that is not only its merits.
 */
export function swapSentences(s: {
  in: string[];
  out: string[];
  kind: string;
  reasons: SwapReason[];
}): { why: string; weaker: string | null } {
  const ins = new Set(s.in);
  const outs = new Set(s.out);
  const clauses: Array<{ name: string; text: string; term: string }> = [];
  for (const r of s.reasons) {
    if (r.value <= 0 || !ins.has(r.name)) continue;
    const text = countsClause(r.note) ?? clauseFor(WHY_IN, r);
    if (!text || clauses.some((c) => c.term === r.term)) continue;
    clauses.push({ name: r.name, text, term: r.term });
    if (clauses.length === 2) break;
  }
  const named = s.in.length > 1;
  const body = clauses.map((c, i) =>
    named ? `${c.name} ${c.text}` : i === 0 ? capital(c.text) : c.text
  );
  const why =
    s.kind === 'repair'
      ? `A build rule you set needed this swap${
          clauses.length
            ? `, and ${named ? '' : `${s.in[0]} `}${clauses.map((c) => (named ? `${c.name} ${c.text}` : c.text)).join(' and ')}`
            : ''
        }.`
      : body.length
        ? `${body.join(' and ')}.`
        : `${s.in.join(' and ')} ${s.in.length > 1 ? 'fit' : 'fits'} this deck better overall.`;

  // The card that left: what it cost the deck, else a lower play rate than the newcomer's.
  const weak = new Map<string, string[]>();
  for (const r of s.reasons) {
    if (r.value <= 0 || !outs.has(r.name)) continue;
    const text = clauseFor(COST_OUT, r);
    if (!text) continue;
    const list = weak.get(r.name) ?? [];
    if (!list.includes(text)) list.push(text);
    weak.set(r.name, list);
  }
  const bestIn = Math.max(
    0,
    ...s.reasons.filter((r) => ins.has(r.name)).map((r) => inclusion(r) ?? 0)
  );
  for (const r of s.reasons) {
    if (!outs.has(r.name) || weak.has(r.name)) continue;
    const p = inclusion(r);
    if (p != null && bestIn - p >= 5) {
      weak.set(r.name, [`was in only ${Math.round(p)}% of this commander's decks`]);
    } else if (r.note.startsWith('off-page') && bestIn > 0) {
      weak.set(r.name, ['is rarely played with this commander']);
    }
  }
  const entries = [...weak.entries()].slice(0, 2);
  return {
    why,
    weaker: entries.length
      ? `${entries.map(([name, texts]) => `${name} ${texts.slice(0, 2).join(' and ')}`).join(', and ')}.`
      : null,
  };
}

/** The disclosure behind a repair that left the usual limits, without the objective's own terms. */
export function plainDisclosure(why: string): string {
  return why
    .replace(
      /^no owned card keeps the class floor/,
      'no card you own keeps enough of that kind of card'
    )
    .replace(
      /^no owned card fits inside the role limits/,
      'no card you own fits inside the role limits'
    );
}
