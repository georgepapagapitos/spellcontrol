import crypto from 'node:crypto';

/**
 * Prompt assembly, input hashing, and request validation for the "Read the
 * deck" review (T96). Pure — the model call itself lives in `ai/client.ts`.
 *
 * The system prompt is the feature. It is version-controlled here and changes
 * only with an eval run (4 decks × 2 runs × 2 tiers on Claude Code subagents —
 * see the T96 spec). This is prompt **v6**: v5 (v4's three section labels +
 * weakness-first ordering, plus a closing prescription in the weakness
 * section) with card-behaviour claims tied to the card reference — the model
 * must take what a card taps for / fetches / does from that card's reference
 * line, not from its name. v5's live probe (live-runs/20260815-1506) showed
 * Haiku misreading IN-DECK, fully hydrated lands: Command Tower "taps for
 * nothing but colorless", Wooded Foothills fetching "Forests and Swamps".
 * The failure class is reading comprehension of the reference block, not
 * recall, so v6 replaces the v5 certainty rule ("only when you are certain"
 * — the model is always certain) with the mechanism: no reference-line
 * support, no claim.
 *
 * ⚠️ That second risk is REAL and was caught by a live probe, not by the eval:
 * the first Haiku call under the prescription rule claimed Scalding Tarn and
 * Flooded Strand could fetch a Swamp (neither can) and suggested a second copy
 * of Cabal Coffers in a singleton format. `hydrateOracle` covers the commander
 * and the DECK ONLY, so a prescribed card is un-hydrated by construction and
 * the model is reasoning from memory about it — the same failure class the
 * refine eval fixed by hydrating its pool, in the one feature that has no pool.
 * The prompt therefore ties readability to the card reference explicitly rather
 * than asking the model to self-assess certainty, which it does not do well.
 * A subagent eval will NOT reproduce this: subagents are better instruction
 * followers and better card-text recallers than the shipped tier. Re-verify
 * any change to this section with a live call.
 */
export const DECK_REVIEW_FEATURE = 'deck-review';

/**
 * Section labels the model emits. They exist so the client can stream text
 * straight into its final, titled layout instead of rendering loose paragraphs
 * and reflowing them into place when the stream ends (T102 follow-up).
 *
 * Prompt v4 also moved the weakness FIRST, so display order == emission order
 * and no section ever waits on a later one.
 */
export const WEAKNESS_MARK = '---WEAKNESS---';
export const GAMEPLAN_MARK = '---GAMEPLAN---';
export const WINS_MARK = '---WINS---';

export const DECK_REVIEW_SYSTEM_PROMPT = `You are a Magic: The Gathering deck analyst inside SpellControl, a
collection and deckbuilding app. You will be given a Commander decklist
plus statistics the app already computed and already shows the user on
the same screen.

Write plain prose for the deck's owner, in three labelled sections. Emit
each label on a line of its own, exactly as written here, with the
sections in exactly this order:

${WEAKNESS_MARK}
The weakness that matters most. One thing. One or two paragraphs
diagnosing it, then a closing paragraph prescribing what to do about it.

${GAMEPLAN_MARK}
The gameplan. What is this deck actually trying to do? Name the
specific cards that define it. One paragraph.

${WINS_MARK}
How it wins. The concrete path to ending a game. One paragraph.

The weakness comes first because it is what the reader came for. Work
the deck out fully before you commit to it - read the list, take the
inventory below, decide what actually breaks - and only then start
writing. What you emit first must still be your considered answer, not
your first impression.

On finding the weakness - this is the part that earns your existence:

- The user can already see every number in the statistics block. A
  weakness they could read off a bar chart is not a finding. If your
  answer is "removal is low" or "card draw is low" or "the curve is
  high," you have not looked hard enough. Find what the numbers cannot
  show.
- Take a functional inventory the statistics do not model. Count
  enablers against payoffs: how many cards want a thing to happen,
  versus how many cards can actually make it happen? A deck with many
  payoffs and few enablers looks healthy in every category and still
  does not function.
- Ask what single common opposing card or effect turns this deck off,
  and whether the deck runs any answer to it.
- Ask what happens on the turn after the engine is disrupted.
- Check castability. The land count can be healthy while the mana is
  not: compare the colored mana symbols the deck's spells and commander
  actually demand against the colors its lands actually produce. Take
  what each land produces or fetches from that land's line in the card
  reference, never from its name or your memory of it - land names lie,
  and a castability case built on a misread land collapses entirely.
  Before you write that a land taps only for colorless, or that a fetch
  land finds only certain land types, re-read its reference line and
  confirm the line says so. A deck that cannot reliably cast its own
  spells has no other weakness worth naming first.

On prescribing the fix - a diagnosis the reader cannot act on is half an
answer. Close the weakness section with a paragraph that says what to do:

- Two or three fixes, each one aimed at the weakness you just diagnosed.
  Nothing generic. "More removal" is not a fix; "an instant-speed answer
  to an artifact, which this deck currently cannot touch at all" is.
- Lead each fix with the EFFECT the deck is missing, described precisely
  enough that the reader could search a collection for it - the class of
  card, at what speed, on what permanent type. The effect is the fix; a
  card name is only ever an illustration of it.
- The card reference is the complete list of cards whose text you can
  actually read. A card that is not in it is a card you are recalling
  from memory, and you are not reliable there: you may name one as a
  familiar example of the effect, but do NOT state what it does, what it
  fetches, what it taps for, what it costs, or what type line it has.
  Say the effect in your own words and let the name sit beside it as a
  pointer. A confidently wrong card text is worse than no card name at
  all, and it is the one mistake in this section a reader cannot catch.
- This is a singleton format. Never suggest a second copy of a card the
  deck already runs - basic lands are the only exception.
- Prefer a fix the deck can make with what it already owns: a card in
  the list being underused, a line being played in the wrong order. When
  slots have to come from somewhere, name the specific weak ones worth
  cutting - those you can read straight off the list.
- Stay inside the commander's colour identity, and stay inside the
  deck's evident power level and budget.
- Two or three. Not a shopping list - a separate deterministic engine
  produces the full add/cut list elsewhere in the app. This paragraph is
  the part that tells the reader what to look for and why.

Rules:
- Outside that closing prescription, reference only cards that appear in
  the decklist. The prescription may name a card the deck does not run,
  but every card you name anywhere must be one that really exists and
  whose text you are certain of. Never invent a card.
- Every claim about what a specific card does - what it taps for, what
  it fetches, what it costs, what it triggers - must come from that
  card's line in the card reference. Re-read the line before you commit
  the claim; if the line does not support it, do not make it, however
  well you think you know the card. For a card with no reference line,
  reason about the deck without it.
- Do not restate the statistics back at the user.
- No headers beyond the three section labels above, and no bullet
  lists. Prose. Second person ("your deck").
- Emit the three labels verbatim, each alone on its line, and write
  nothing before the first one.
- Be direct. If the deck genuinely has no structural problem, say so
  briefly rather than manufacturing one - and then prescribe the
  sharpening it would actually benefit from, in one or two fixes rather
  than three. A thin prescription on a tuned deck is right; an invented
  weakness so the prescription has something to cure is not. A
  structural claim must survive the actual card text: before asserting
  the deck lacks something, check the list for cards that already do
  it. A weakness
  built on a card the deck does have is worse than no finding.`;

export interface DeckReviewCard {
  name: string;
  oracleId: string;
  qty: number;
}

export interface DeckReviewRequest {
  deckId: string;
  commander: string;
  cards: DeckReviewCard[];
  /** The frontend's DeckAnalysisResult — opaque here; rendered defensively. */
  analysis: Record<string, unknown>;
}

export const MAX_CARDS = 260;
/** Route-level payload ceiling — far under the global body limit. */
export const MAX_ANALYSIS_JSON_BYTES = 64 * 1024;

/** Validate an untrusted body into a DeckReviewRequest, or return an error string. */
export function parseDeckReviewRequest(
  body: unknown
): { ok: true; value: DeckReviewRequest } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) return { ok: false, error: 'Body required.' };
  const b = body as Record<string, unknown>;
  if (typeof b.deckId !== 'string' || !b.deckId) return { ok: false, error: 'deckId is required.' };
  if (typeof b.commander !== 'string' || !b.commander.trim()) {
    return { ok: false, error: 'commander is required.' };
  }
  if (!Array.isArray(b.cards) || b.cards.length === 0) {
    return { ok: false, error: 'cards is required.' };
  }
  if (b.cards.length > MAX_CARDS) {
    return { ok: false, error: `cards must have at most ${MAX_CARDS} entries.` };
  }
  const cards: DeckReviewCard[] = [];
  for (const c of b.cards) {
    if (typeof c !== 'object' || c === null) return { ok: false, error: 'Invalid card entry.' };
    const { name, oracleId, qty } = c as Record<string, unknown>;
    if (typeof name !== 'string' || !name.trim() || name.length > 200) {
      return { ok: false, error: 'Invalid card name.' };
    }
    if (typeof oracleId !== 'string' || oracleId.length > 64) {
      return { ok: false, error: 'Invalid card oracleId.' };
    }
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1 || qty > 99) {
      return { ok: false, error: 'Invalid card qty.' };
    }
    cards.push({ name: name.trim(), oracleId, qty });
  }
  if (typeof b.analysis !== 'object' || b.analysis === null || Array.isArray(b.analysis)) {
    return { ok: false, error: 'analysis is required.' };
  }
  if (JSON.stringify(b.analysis).length > MAX_ANALYSIS_JSON_BYTES) {
    return { ok: false, error: 'analysis is too large.' };
  }
  return {
    ok: true,
    value: {
      deckId: b.deckId,
      commander: (b.commander as string).trim(),
      cards,
      analysis: b.analysis as Record<string, unknown>,
    },
  };
}

/** JSON.stringify with recursively sorted object keys, so hashing is stable. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * The cache key: content hash over commander + sorted card list + analysis.
 * The same hash is the staleness signal — a review is stale exactly when the
 * deck's current hash differs from the one it was written for. No edit
 * counters (a counter and a hash drift: edit a card and revert it and they
 * disagree).
 */
export function hashDeckReviewInput(req: DeckReviewRequest): string {
  const canonical = stableStringify({
    commander: req.commander,
    cards: [...req.cards]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((c) => ({ name: c.name, oracleId: c.oracleId, qty: c.qty })),
    analysis: req.analysis,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * Render the frontend's DeckAnalysisResult into the compact stats block the
 * prompt was evaluated against. Defensive: any missing/unknown field is
 * skipped rather than thrown on — the payload shape is owned by the frontend.
 */
export function renderAnalysis(analysis: Record<string, unknown>): string {
  const lines: string[] = [];
  const types = analysis.types as Record<string, unknown> | undefined;
  const curve = analysis.curve as Record<string, unknown> | undefined;

  if (typeof analysis.totalNonCommander === 'number') {
    lines.push(`- Cards (excluding commander): ${analysis.totalNonCommander}`);
  }
  if (types && typeof types.lands === 'number') lines.push(`- Lands: ${types.lands}`);
  if (curve && typeof curve.averageCmc === 'number') {
    lines.push(`- Average mana value (nonland): ${curve.averageCmc}`);
  }
  if (curve && Array.isArray(curve.buckets)) {
    const parts = (curve.buckets as unknown[])
      .filter(
        (b): b is { cmc: number; count: number } =>
          typeof b === 'object' &&
          b !== null &&
          typeof (b as Record<string, unknown>).cmc === 'number' &&
          typeof (b as Record<string, unknown>).count === 'number'
      )
      .map((b) => `${b.cmc >= 7 ? '7+' : b.cmc}: ${b.count}`);
    if (parts.length > 0) lines.push(`- Curve (nonland): ${parts.join(' · ')}`);
  }
  if (Array.isArray(analysis.roles)) {
    const parts = (analysis.roles as unknown[])
      .filter(
        (r): r is { label: string; count: number } =>
          typeof r === 'object' &&
          r !== null &&
          typeof (r as Record<string, unknown>).label === 'string' &&
          typeof (r as Record<string, unknown>).count === 'number'
      )
      .map((r) => `${r.label} ${r.count}`);
    if (parts.length > 0) lines.push(`- Roles: ${parts.join(' · ')}`);
  }
  if (types) {
    const order = [
      ['creatures', 'Creatures'],
      ['instants', 'Instants'],
      ['sorceries', 'Sorceries'],
      ['artifacts', 'Artifacts'],
      ['enchantments', 'Enchantments'],
      ['planeswalkers', 'Planeswalkers'],
      ['battles', 'Battles'],
    ] as const;
    const parts = order
      .filter(([key]) => typeof types[key] === 'number' && (types[key] as number) > 0)
      .map(([key, label]) => `${label} ${types[key] as number}`);
    if (parts.length > 0) lines.push(`- Type spread: ${parts.join(' · ')}`);
  }
  return lines.length > 0 ? lines.join('\n') : '- (no statistics available)';
}

export interface OracleEntry {
  name: string;
  manaCost?: string;
  typeLine?: string;
  oracleText?: string;
}

/** Assemble the user message: decklist + on-screen stats + oracle reference. */
export function buildUserMessage(req: DeckReviewRequest, oracle: OracleEntry[]): string {
  const decklist = req.cards.map((c) => `${c.qty} ${c.name}`).join('\n');
  const parts = [
    `Commander: ${req.commander}`,
    `## Decklist (${req.cards.reduce((n, c) => n + c.qty, 0)})\n\n${decklist}`,
    `## Statistics (already shown to the user on the same screen)\n\n${renderAnalysis(req.analysis)}`,
  ];
  if (oracle.length > 0) {
    const ref = oracle
      .map((o) => {
        const head = [o.name, o.manaCost, o.typeLine ? `— ${o.typeLine}` : '']
          .filter(Boolean)
          .join(' ');
        return o.oracleText ? `${head}: ${o.oracleText.replace(/\n/g, ' ')}` : head;
      })
      .join('\n');
    parts.push(
      `## Card reference (oracle text from the app's card database; may be incomplete)\n\n${ref}`
    );
  }
  return parts.join('\n\n');
}
