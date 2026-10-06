// E513: the whole-deck search's reasons, in the words a deck builder uses.
// The objective's per-card notes are written for the search's own logs
// ("answer #4: … (0.7)", "1.93 price doublings", "screw 12% by turn 3"); every
// generated deck now shows them, so each shape is restated here, plainly,
// before it reaches the build report. The wording is the only thing changed:
// the search never reads these strings.

const pct = (n: string) => `${Math.round(Number(n))}%`;
const CLEAN: ReadonlyArray<[RegExp, (m: RegExpMatchArray) => string]> = [
  [
    /^([\d.]+)% of this page's decks, [\d.]+% price-adjusted \(([^)]*)\)$/,
    (m) => `in ${pct(m[1])} of this commander's decks (${m[2]})`,
  ],
  [/^([\d.]+)% of this page's decks$/, (m) => `in ${pct(m[1])} of this commander's decks`],
  [/^off-page: read at .*$/, () => `not often played with this commander`],
  [/^answer #\d+: (.+?) \([\d.]+\)$/, (m) => `an answer: ${m[1]}`],
  [
    /^draw engine #\d+: draws (on every trigger|continuously|every turn) \([\d.]+\)$/,
    (m) => `a card-draw engine that draws ${m[1]}`,
  ],
  [
    /^protection #\d+ \([\d.]+\): keeps the commander on the battlefield$/,
    () => `keeps the commander on the battlefield`,
  ],
  [/^protection #\d+ \([\d.]+\)$/, () => `protects the deck`],
  [/^tutor #\d+: finds (.+?) \([\d.]+\)$/, (m) => `a tutor that finds ${m[1]}`],
  [
    /^castable on curve ([\d.]+)% \(turn (\d+)\)$/,
    (m) => `cast on turn ${m[2]} in ${pct(m[1])} of games`,
  ],
  [
    /^commander on curve ([\d.]+)%$/,
    (m) => `the commander comes down on time in ${pct(m[1])} of games`,
  ],
  [
    /^(?:no )?land base: screw ([\d.]+)% by turn 3, flood ([\d.]+)% at turn 6$/,
    (m) =>
      `the lands: ${pct(m[1])} of games miss a land drop by turn 3, ${pct(m[2])} flood by turn 6`,
  ],
  [/^buy for ([\d.]+ \w+): [\d.]+ price doublings$/, (m) => `you would have to buy it, ${m[1]}`],
  [/^lifted by (.+)$/, (m) => `played more often alongside ${m[1]}`],
  [
    /^pays off (.+?) \(payoff \d+ of \d+\), fed by (.+)$/,
    (m) => `pays off the deck's ${m[1]} cards, fed by ${m[2]}`,
  ],
  [
    /^piece of (.+?) \((\d+) decks(?:: (.+))?\)$/,
    (m) => `part of the ${m[1]} combo, in ${m[2]} decks${m[3] ? ` (${m[3]})` : ''}`,
  ],
  [/^plays [\d.]+ strength over its colors$/, () => `played above its colors' average here`],
  [
    /^this commander's players avoid it \(strength -?[\d.]+\)$/,
    () => `this commander's players tend to avoid it`,
  ],
  [
    /^(.+?) phase is (heavy|thin): ([\d.]+)% of spells, target ([\d.]+)%$/,
    (m) =>
      `the ${m[1]} part of the curve is ${m[2]} (${pct(m[3])} of spells, aiming for ${pct(m[4])})`,
  ],
  [
    /^finisher: a line is online ([\d.]+)% of turns 1-(\d+)$/,
    (m) => `a finisher: the deck can win by turn ${m[2]} in ${pct(m[1])} of games`,
  ],
  [
    /^win-combo piece: a line is online ([\d.]+)% of turns 1-(\d+)$/,
    (m) => `a win-combo piece: the deck can win by turn ${m[2]} in ${pct(m[1])} of games`,
  ],
  [
    /^(\w[\w ]*) is (short|overbuilt): ([\d.]+) (?:of|against) target (\d+)$/,
    (m) =>
      `${m[1]} is ${m[2] === 'short' ? 'short' : 'overbuilt'} (${Math.round(Number(m[3]))} against ${m[4]} wanted)`,
  ],
  [/^(\w[\w ]*) 0 of target (\d+)$/, (m) => `no ${m[1]}, aiming for ${m[2]}`],
  [
    /^roles: (.+)$/,
    (m) =>
      `card counts: ${m[1].replace(/(\d+) → (\d+) of target (\d+)/g, '$1 → $2 (aiming for $3)')}`,
  ],
];

/** One note in plain words; a shape this doesn't know passes through untouched. */
export function plainNote(note: string): string {
  for (const [re, fix] of CLEAN) {
    const m = note.match(re);
    if (m) return fix(m);
  }
  return note;
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
