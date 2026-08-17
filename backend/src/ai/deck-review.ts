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
 *
 * v7 adds the bracket target/estimate line (payload/prompt-contract work
 * alongside the analysis-payload trim that dropped `roles[].contributingSlotIds`
 * and every other field `renderAnalysis` doesn't read). The Commander bracket
 * system is recent, and Haiku-tier reasoning about it from memory is exactly
 * the failure class v6 exists to eliminate for card text - so the bracket
 * clause uses the same mechanism: the numbers are GIVEN DATA, never something
 * to infer, recompute, or explain back to the reader. Re-verify with a live
 * probe, same as v6.
 *
 * v8 gives the model a `lookup_cards` tool and makes the prescription's card
 * names checkable: a name may come from the decklist or from a card it looked
 * up, and nowhere else. This is the same move as v6 — replace a request the
 * model cannot self-assess with a mechanism it can — applied to the one gap v6
 * could not reach. v6 tied card BEHAVIOUR to the reference block, but the
 * prescription names cards that have no reference line by construction
 * (`hydrateOracle` covers commander + deck only), so the rule had nothing to
 * bite on there. A tool supplies the missing reference lines on demand, and
 * `unverifiedCitations` checks the finished prose against what was actually
 * fetched. Measured before this change on `fixture-3-healthy` at n=12: 6/12
 * runs named at least one card that was neither in the deck nor verifiable.
 *
 * v11 gives the answer an END, which every earlier version lacked. The marker
 * gate opens on the first section label and keeps that turn whole; it only
 * knows how to drop a turn that never marked at all (#1644 and #1647 fixed that
 * half, twice). So a turn that wrote the WHOLE review and then carried on
 * thinking sailed straight through — and the client slices its last section to
 * the end of the text, so the notes rendered inside "How it wins".
 *
 * Reported from production and reproduced live: one baseline run trailed the
 * finished review with **38 lines** of self-deliberation ("Actually, wait. Let
 * me re-read the rules again:", "Let me count sentences:"), every line of it
 * displayed. Measured on `fixture-1-grounding`, 3 arms, n=22/build: trailing
 * leaks 1/22 → 0/22, total leaked narration 40 lines → 3.
 *
 * ⚠️ It does NOT close MID-answer narration — the model interrupting itself
 * before the last section (2-3/22 on both builds, a line or two each). A
 * terminator cannot reach that by construction, and two attempts at it were
 * measured and rejected; see `createMarkerGate` in `ai/tools.ts` for both and
 * for the design that would.
 */
export const DECK_REVIEW_FEATURE = 'deck-review';

/** Bump whenever DECK_REVIEW_SYSTEM_PROMPT's text changes. */
export const DECK_REVIEW_PROMPT_VERSION = 'v12';

/**
 * Section labels the model emits. They exist so the client can stream text
 * straight into its final, titled layout instead of rendering loose paragraphs
 * and reflowing them into place when the stream ends (T102 follow-up).
 *
 * Prompt v4 also moved the weakness FIRST, so display order == emission order
 * and no section ever waits on a later one.
 */
export const WEAKNESS_MARK = '---WEAKNESS---';
export const FIXES_MARK = '---FIXES---';
export const GAMEPLAN_MARK = '---GAMEPLAN---';
export const WINS_MARK = '---WINS---';

/**
 * The answer's terminator (v11).
 *
 * Everything from here on is discarded and the gate latches shut, so the model
 * carrying on after it — to second-guess itself, to re-check the rules, to
 * restate the fix — cannot reach the reader. It is emitted like the section
 * labels, which the model gets right unaided (0/22 missed it), and forgetting
 * it is not a regression: the gate then behaves exactly as v10 did.
 */
export const END_MARK = '---END---';

/**
 * Phase 1 of two. The model researches with `lookup_cards` here and **writes
 * nothing anyone sees** — only the cards it retrieves are carried forward, into
 * the writing pass's user message.
 *
 * This split exists because the marker gate's central rule — a markerless turn
 * that ended in a tool call is research, so drop it — is only true if the model
 * never searches while writing. Measured on the raw stream, it does: it emits a
 * section label, THEN searches, then writes the body, so the body arrived in
 * markerless turns and was discarded as research (a labelled section came back
 * EMPTY in 3 of 6 runs). Asking the prompt to search first did not hold, and
 * `tool_choice: none` after the answer opens was measured and rejected — denied
 * the tool the model narrates a search it cannot perform and never finishes.
 *
 * Separating the passes makes the rule true instead of hoping for it: the
 * writing pass has no tools, so there is nothing to narrate toward, no turn
 * boundary to lose a section body at, and no denied tool to fake.
 */
export const DECK_REVIEW_RESEARCH_PROMPT = `You are preparing a Magic: The
Gathering deck review inside SpellControl. You are NOT writing the review -
a separate pass does that. Your only job is to find the cards that pass
will need, using the lookup_cards tool.

Work the deck out first. Read the list, take a functional inventory the
statistics do not model - count enablers against payoffs, ask what single
common opposing effect turns the deck off, check whether the coloured mana
its spells demand matches what its lands actually produce - and decide what
really breaks. Only then search.

Search for the EFFECT the deck is missing, in rules wording: "destroy
target artifact", "return creature card from your graveyard to the
battlefield", "add one mana of any colour". Not a card name, not a concept.
Results come back already filtered to this commander's colour identity, to
Commander-legal cards, and excluding what the deck already runs, so
anything you get is a legal suggestion for this deck.

Two searches. Three at the very most, and only if the first two came back
with nothing usable. Each one is slow and a reader is already waiting. A
broad query returns better options than four narrow ones; do not re-run a
search to confirm what the last one told you, and do not search for effects
you have already ruled out.

Write no prose. Nothing you write in this pass is shown to anyone or passed
on - only the cards you retrieve are. When you have them, stop.`;

export const DECK_REVIEW_SYSTEM_PROMPT = `You are a Magic: The Gathering deck analyst inside SpellControl, a
collection and deckbuilding app. You will be given a Commander decklist
plus statistics the app already computed and already shows the user on
the same screen.

Write plain prose for the deck's owner, in four labelled sections. Emit
each label on a line of its own, exactly as written here, with the
sections in exactly this order:

${WEAKNESS_MARK}
The weakness that matters most. One thing. ONE paragraph of at most four
sentences diagnosing it. Diagnosis only - what to do about it is the
next section.

${FIXES_MARK}
What to do about it. One fix per line, at most two lines, and nothing
else on the line. No bullet characters and no numbering - the app numbers
them. One sentence each, two at the most.

${GAMEPLAN_MARK}
The gameplan. What is this deck actually trying to do? Name the
specific cards that define it. One paragraph, at most three sentences.

${WINS_MARK}
How it wins. The concrete path to ending a game. One paragraph, at most
three sentences.

${END_MARK}

${END_MARK} closes the reading. Emit it on a line of its own once the
last section is written, and stop there. Everything after it is
discarded, so notes to yourself, a re-check of these instructions, a
restatement of the prescription or a second attempt at a section all
reach nobody - if you want to revise something, revise it before you
emit the terminator.

Those limits are hard. The whole reading is at most twelve sentences,
and a reader who has to scroll it has been failed before they reach the
part that helps. This is the constraint most likely to slip while you
are concentrating on being right, so count as you write: a fifth
sentence in the diagnosis means the first four were not the four that
mattered, and the fix is to cut, never to compress two thoughts into one
longer sentence. Sentences stay short - past roughly twenty-five words
you are writing two.

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

On the bracket line, when the statistics include one: it may show a
target the owner set and/or an estimate the app computed for the deck as
built. Both are GIVEN DATA - the app computed them, the same way the card
reference is the app's data on what a card does. Never infer a bracket
from the decklist, never recompute one, and never explain what a bracket
is or how the system works - the reader already has that context from the
rest of the screen; your job is to use the numbers, not narrate them.

- When both are present and the estimate sits ABOVE the target, that gap
  is the weakness worth naming: the deck is stronger than its owner
  wants. Your prescription must say what to CUT to close it, naming
  specific cards from the decklist that carry the excess power.
- When the estimate sits BELOW the target, the deck is weaker than its
  owner intended - diagnose accordingly, on its own merits.
- When the two match, or no target is set, ignore the bracket line
  entirely and diagnose the deck purely on its own merits.

On the ${FIXES_MARK} section - a diagnosis the reader cannot act on is
half an answer, and this is the half they act on:

- Two fixes, each one aimed at the weakness you just diagnosed, each on
  a line of its own. Nothing generic. "More removal" is not a fix;
  "an instant-speed answer to an artifact, which this deck currently
  cannot touch at all" is. If the deck only needs one, prescribe one -
  the sentence budget is a ceiling, not a quota to fill.
- Lead each fix with the EFFECT the deck is missing, described precisely
  enough that the reader could search a collection for it - the class of
  card, at what speed, on what permanent type. Then name the cards that
  supply it. The effect tells the reader what is wrong; the names are
  what they act on.
- The cards you may prescribe have already been looked up for you, and
  they are in the "Cards you looked up" section of the message. They are
  real, they are legal in this deck's colour identity, and the deck does
  not already run them. That search is done - you cannot run another, so
  work with what is there.
- Name a card only if it is in the decklist or in that section. Those are
  the only two places a name can come from. A card you merely remember is
  not a card you may name - describe the effect instead. This is
  checkable after the fact, and it is checked.
- A card in that section is yours to name, and you should name it. Hand
  the reader the one or two best ones - by name - and say what each does
  for this deck. A fix that describes an effect and names nothing sends
  the reader off to search for what has already been found for them, and
  it is the most common way this section disappoints. Only when nothing
  in the section fits the fix do you describe the effect alone, and then
  say that is what happened.
- A looked-up card's line is what it does. Quote behaviour from that
  text, never from memory - a confidently wrong card text is the one
  mistake in this section a reader cannot catch. That is a reason to read
  the line you were given before you write, not a reason to withhold the
  name.
- This is a singleton format. Never suggest a second copy of a card the
  deck already runs - basic lands are the only exception.
- Prefer a fix the deck can make with what it already owns: a card in
  the list being underused, a line being played in the wrong order. When
  slots have to come from somewhere, name the specific weak ones worth
  cutting - those you can read straight off the list.
- Stay inside the commander's colour identity, and stay inside the
  deck's evident power level and budget.
- Not a shopping list - a separate deterministic engine produces the
  full add/cut list elsewhere in the app. This section is the part
  that tells the reader what to look for and why.

Rules:
- Outside the ${FIXES_MARK} section, reference only cards that appear in
  the decklist. A fix may name a card the deck does not run, but every
  card you name anywhere must be one that really exists and whose text
  you are certain of. Never invent a card.
- Every claim about what a specific card does - what it taps for, what
  it fetches, what it costs, what it triggers - must come from that
  card's line in the card reference. Re-read the line before you commit
  the claim; if the line does not support it, do not make it, however
  well you think you know the card. For a card with no reference line,
  reason about the deck without it.
- Do not restate the statistics back at the user.
- No headers beyond the section labels above, and no bullet lists or
  numbering anywhere - one fix per line is the whole of the structure.
  Prose. Second person ("your deck").
- Emit the four labels and the terminator verbatim, each alone on its
  line. Write nothing before the first label and nothing after the
  terminator.
- Be direct. If the deck genuinely has no structural problem, say so
  briefly rather than manufacturing one - and then prescribe the
  sharpening it would actually benefit from, in a single fix rather than
  two. A thin prescription on a tuned deck is right; an invented
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
 * The cache key: content hash over the PROMPT VERSION + commander + sorted card
 * list + analysis. The same hash is the staleness signal — a review is stale
 * exactly when the deck's current hash differs from the one it was written for.
 * No edit counters (a counter and a hash drift: edit a card and revert it and
 * they disagree).
 *
 * The prompt version is in the key because the prompt IS the feature. Without
 * it a prompt change is invisible on every deck that already has a reading:
 * the row replays verbatim, "Read again" re-hashes to the same key, and the
 * only way to observe the new prompt is to edit the deck or delete the row by
 * hand. That cost a real debugging session (board E254) — the fix that shipped
 * looked like it had done nothing. A reading written by a different prompt is
 * stale by definition, which is exactly what this key already means.
 *
 * The bump is deliberate and rare, so this invalidates only when the prompt
 * text actually changes; a deck whose reading is current stays cached.
 */
export function hashDeckReviewInput(req: DeckReviewRequest): string {
  const canonical = stableStringify({
    promptVersion: DECK_REVIEW_PROMPT_VERSION,
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
  const bracket = analysis.bracket as Record<string, unknown> | undefined;
  if (bracket) {
    const target = typeof bracket.target === 'number' ? bracket.target : null;
    const estimate = typeof bracket.estimate === 'number' ? bracket.estimate : null;
    if (target != null && estimate != null) {
      lines.push(
        `- Bracket: target ${target} (what the owner wants) · estimate ${estimate} (what the deck is now)`
      );
    } else if (target != null) {
      lines.push(`- Bracket target: ${target} (what the owner wants; no current estimate)`);
    } else if (estimate != null) {
      lines.push(`- Bracket estimate: ${estimate} (what the deck is now; no target set)`);
    }
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

/**
 * Card names the review cites that it has no grounds to cite.
 *
 * The prompt lets the prescription name a card the deck doesn't run — a named
 * example is a real reader affordance (E245) — but before tools existed there
 * was nothing behind such a name except the model's memory, and a measured
 * 6/12 of reviews on a healthy deck named at least one. `lookup_cards` gives
 * the model a way to name cards it has actually read, so the claim becomes
 * checkable: a cited card must be in the decklist or in what it fetched.
 *
 * Pure, so it tests without a cache: `isRealCard` decides what counts as a card
 * name. Over-collects capitalised runs and lets that predicate reject the
 * prose, which is the same shape the eval's grader uses — a phrase only counts
 * once the card database confirms it.
 *
 * Single words are ignored. "There", "Ramp" and "Treasure" are all real card
 * names against a 100k-card database, and counting them made the eval's version
 * of this metric mostly false positives.
 */
export function unverifiedCitations(
  prose: string,
  allowed: Iterable<string>,
  isRealCard: (name: string) => boolean
): string[] {
  const ok = new Set([...allowed].map((n) => n.toLowerCase()));
  const WORD = "[A-Z][\\w'’-]*";
  const JOIN = '(?:of|the|and|to|in|a|an|from|with|for)';
  const re = new RegExp(`\\b${WORD}(?:[ -](?:${JOIN}|${WORD}))*`, 'g');
  const out = new Set<string>();

  for (const match of prose.matchAll(re)) {
    const words = match[0].replace(/[\s,]+$/, '').split(/\s+/);
    // Scan every window in the run, not just its prefixes. A capitalised run
    // routinely starts on an ordinary word — "Cut Wooded Foothills", "Swap
    // Wooded Foothills for Verdant Catacombs" — and a prefix-only scan tries
    // "Cut Wooded Foothills", then "Cut Wooded", and never reaches the card.
    // Longest window at each position wins, then skip past it so one sentence
    // can yield both names.
    for (let start = 0; start < words.length; ) {
      let matched = 0;
      for (let len = words.length - start; len >= 2; len--) {
        const candidate = words.slice(start, start + len).join(' ');
        if (!isRealCard(candidate)) continue;
        if (!ok.has(candidate.toLowerCase())) out.add(candidate);
        matched = len;
        break;
      }
      start += matched || 1;
    }
  }
  return [...out];
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

/**
 * The research pass's findings, as a section appended to the writing pass's
 * user message. Structural, not stylistic: these are the ONLY card names the
 * writing pass may introduce, so they arrive as data in the message rather than
 * as something it has to go and fetch mid-sentence.
 *
 * Empty in returns empty out, and the caller appends nothing — a review whose
 * research found nothing should not be told it has a list.
 */
export function renderFetchedCards(
  fetched: { name: string; typeLine?: string; oracleText?: string }[]
): string {
  if (fetched.length === 0) return '';
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const card of fetched) {
    if (seen.has(card.name)) continue;
    seen.add(card.name);
    // Type line and text are always present off a real tool result, but a card
    // is still nameable without them — a missing field must not cost the model
    // the whole line.
    const head = card.typeLine ? `${card.name} — ${card.typeLine}` : card.name;
    lines.push(card.oracleText ? `${head}: ${card.oracleText.replace(/\n/g, ' ')}` : head);
  }
  return (
    '## Cards you looked up (real cards, legal in this deck, not already in it —\n' +
    'these are the only cards outside the decklist you may name)\n\n' +
    lines.join('\n')
  );
}
