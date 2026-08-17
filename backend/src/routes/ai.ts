import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { APIUserAbortError } from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { loadAuthedUser, readSessionCookie, requireAuth } from '../auth';
import { getPool } from '../db';
import { testAwareLimiter } from '../route-utils';
import { getScryfallCache } from '../scryfall-cache';
import { aiEnabled, generateReview, AI_MODEL } from '../ai/client';
import { checkBracketTool, lookupCardsTool, makeCandidateResolver, type AiTool } from '../ai/tools';
import { getTagLookup } from '../ai/tags';
import { estimateForNames, renderBracketCheck } from '../ai/bracket';
import { loadRelevantCombos } from './combos';
import {
  DECK_REVIEW_FEATURE,
  DECK_REVIEW_PROMPT_VERSION,
  DECK_REVIEW_SYSTEM_PROMPT,
  WEAKNESS_MARK,
  buildUserMessage,
  hashDeckReviewInput,
  parseDeckReviewRequest,
  unverifiedCitations,
  type OracleEntry,
} from '../ai/deck-review';
import {
  DECK_REFINE_FEATURE,
  DECK_REFINE_PROMPT_VERSION,
  DECK_REFINE_SYSTEM_PROMPT,
  STRATEGY_MARK,
  TWEAKS_DELIMITER,
  buildRefineMessage,
  hashRefineInput,
  parseRefineOutput,
  parseRefineRequest,
  type RefineTweak,
} from '../ai/deck-refine';

/**
 * Oracle facts don't expire the way prices do, so card lookups that only read
 * name/type/text ignore the cache's 7-day TTL — the same reasoning
 * `getMany`'s `allowStale` documents. Never read a price off one of these.
 */
const ORACLE_MAX_AGE_MS = Number.MAX_SAFE_INTEGER;

/**
 * The commander's colour identity, so card search only returns cards this deck
 * could legally run. A miss returns undefined, which searches unrestricted —
 * better a wider search than none, and the prompt still states the rule.
 */
function commanderIdentity(
  cache: ReturnType<typeof getScryfallCache>,
  commander: string
): string[] | undefined {
  return cache.getCheapestByName(commander, ORACLE_MAX_AGE_MS)?.color_identity ?? undefined;
}

/**
 * Opt-in AI features (T96 "Read the deck"). Consent is enforced server-side —
 * a hidden button is not consent — and the whole router 404s when the API key
 * is absent, so `main` stays shippable without the feature configured.
 *
 * Reviews are cached by content hash in `ai_reviews`, which doubles as the
 * per-user quota meter (count today's rows) and the cost audit trail (token
 * columns). AI output never enters the sync layer.
 */
export const aiRouter: Router = Router();

export const DEFAULT_DAILY_LIMIT = 10;

const reviewLimiter = testAwareLimiter({ windowMs: 60_000, max: 10 });
const optInLimiter = testAwareLimiter({ windowMs: 60_000, max: 20 });

/**
 * Feature flag: while the AI features are experimental they are admin-only,
 * so they can't be abused before the quota/prompt story is proven out. Set
 * `AI_PUBLIC=1` to open them to every account. Read fresh per request (like
 * `ADMIN_USERNAMES`) so flipping the env var needs no rebuild.
 */
const aiPublic = (): boolean => process.env.AI_PUBLIC === '1';

aiRouter.use(async (req: Request, res: Response, next) => {
  if (!aiEnabled()) return res.status(404).json({ error: 'Not found.' });
  if (aiPublic()) return next();
  // Non-admins get the same 404 as an unconfigured backend: the client treats
  // 404 as "feature unavailable" and renders nothing, so the UI hides itself
  // and the endpoints aren't advertised.
  const token = readSessionCookie(req);
  const user = token ? await loadAuthedUser(token) : null;
  if (user?.role !== 'admin') return res.status(404).json({ error: 'Not found.' });
  next();
});

interface AiUserRow {
  ai_opt_in: boolean;
  ai_daily_limit: number | null;
}

async function loadAiUser(userId: string): Promise<AiUserRow> {
  const res = await getPool().query<AiUserRow>(
    'SELECT ai_opt_in, ai_daily_limit FROM users WHERE id = $1',
    [userId]
  );
  return res.rows[0] ?? { ai_opt_in: false, ai_daily_limit: null };
}

async function usedToday(userId: string): Promise<number> {
  const dayStartMs = new Date().setUTCHours(0, 0, 0, 0);
  const res = await getPool().query<{ n: string }>(
    'SELECT COUNT(*) AS n FROM ai_reviews WHERE user_id = $1 AND created_at >= $2',
    [userId, dayStartMs]
  );
  return Number(res.rows[0]?.n ?? 0);
}

// ────────────────────────────────────────────────
// GET /api/ai/status — everything the UI needs to gate itself:
// opt-in state, today's usage, and the effective daily limit.
// (404 from the router guard = the feature is unavailable entirely.)
// ────────────────────────────────────────────────
aiRouter.get('/status', requireAuth, async (req: Request, res: Response) => {
  const user = await loadAiUser(req.user!.id);
  const used = user.ai_opt_in ? await usedToday(req.user!.id) : 0;
  res.json({
    optIn: user.ai_opt_in,
    used,
    limit: user.ai_daily_limit ?? DEFAULT_DAILY_LIMIT,
  });
});

// ────────────────────────────────────────────────
// GET /api/ai/history?deckId=… — past readings for one deck, newest first.
// A DB read of the user's own generated content: free, spends no quota, and
// never touches the model. Rows written before deck_id existed aren't listed.
// ────────────────────────────────────────────────
aiRouter.get('/history', requireAuth, async (req: Request, res: Response) => {
  const deckId = req.query.deckId;
  if (typeof deckId !== 'string' || !deckId || deckId.length > 200) {
    return res.status(400).json({ error: 'deckId is required.' });
  }
  const rows = await getPool().query<{
    id: string;
    content: string;
    model: string;
    created_at: string | number;
    fetched_names: string[] | null;
  }>(
    `SELECT id, content, model, created_at, fetched_names
       FROM ai_reviews
      WHERE user_id = $1 AND feature = $2 AND deck_id = $3
      ORDER BY created_at DESC
      LIMIT 20`,
    [req.user!.id, DECK_REVIEW_FEATURE, deckId]
  );
  res.json({
    readings: rows.rows.map((r) => ({
      id: r.id,
      content: r.content,
      model: r.model,
      createdAt: Number(r.created_at),
      ...(r.fetched_names?.length ? { fetched: r.fetched_names } : {}),
    })),
  });
});

// ────────────────────────────────────────────────
// POST /api/ai/opt-in { enabled: boolean }
// ────────────────────────────────────────────────
aiRouter.post('/opt-in', optInLimiter, requireAuth, async (req: Request, res: Response) => {
  const enabled = (req.body as { enabled?: unknown } | null)?.enabled;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'Body must be { enabled: boolean }.' });
  }
  await getPool().query('UPDATE users SET ai_opt_in = $1 WHERE id = $2', [enabled, req.user!.id]);
  res.json({ optIn: enabled });
});

/**
 * The deck-review wire format (T102): **NDJSON**, one JSON object per line.
 *
 * - `{"delta":"…"}` — a chunk of prose, in order. For live display only.
 * - `{"done":{content,cached,model,usage,fetched?}}` — the terminator, and the
 *   AUTHORITATIVE full text. Its ABSENCE is how the client detects a truncated
 *   stream, so it is the only success signal. Repeating the text costs ~2KB and
 *   buys the guarantee that what gets displayed and what got stored are the
 *   same string — no dependence on the deltas reconstructing exactly.
 * - `{"error":"…"}` — the generation failed *after* headers went out, so the
 *   status code is already 200 and can't carry it.
 *
 * Everything that can fail BEFORE the first byte (validation, consent, quota)
 * still answers with a normal status code and a plain JSON body — the client
 * checks `res.ok` first and never parses those as a stream.
 *
 * Cache hits stream too, as a single delta plus the terminator. They're
 * instant either way, and one wire format means one client code path instead
 * of a content-type branch that only the cached case exercises.
 *
 * Never SSE: the native `EventSource` block (see the online-table work) and the
 * write-after-end crash class both live there. This is plain chunked HTTP.
 */
interface ReviewDone {
  content: string;
  cached: boolean;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  /** Present + true only when the reply was cut off at max_tokens. */
  truncated?: boolean;
  /**
   * Cards the model looked up while writing this review — the ones it is
   * recommending. The client tokenizes prose against the decklist, so without
   * this a *suggested* card is the one card in the reading you cannot tap:
   * it is absent from the deck by definition. Omitted (not `[]`) when there
   * is nothing to send, including for rows stored before the column existed,
   * so the client distinguishes "none" from "unknown" the same way.
   */
  fetched?: string[];
}
type ReviewLine = { delta: string } | { done: ReviewDone } | { error: string };

// ────────────────────────────────────────────────
// POST /api/ai/deck-review — the review itself. Flow: consent → hash →
// cache hit (free, no quota) → quota → hydrate oracle text (cache-only,
// never a live Scryfall fetch) → one streamed model call → store + terminate.
// ────────────────────────────────────────────────
aiRouter.post('/deck-review', reviewLimiter, requireAuth, async (req: Request, res: Response) => {
  const parsed = parseDeckReviewRequest(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const request = parsed.value;
  const userId = req.user!.id;

  const user = await loadAiUser(userId);
  if (!user.ai_opt_in) {
    return res.status(403).json({ error: 'AI features are not enabled for this account.' });
  }

  const inputHash = hashDeckReviewInput(request);
  const pool = getPool();

  // A client that navigates away mid-stream destroys its socket. Writing to a
  // destroyed socket is harmless, but an unhandled 'error' on the response
  // would take the whole process down — one listener retires that class.
  res.on('error', () => {});
  // A disconnect mid-generation should stop billing for a call nobody will
  // read. `writableEnded` guards against the same 'close' event firing on a
  // normal, already-finished response — without it every successful request
  // would abort itself.
  const ac = new AbortController();
  req.on('close', () => {
    if (!res.writableEnded) ac.abort();
  });
  let streaming = false;
  const send = (line: ReviewLine) => {
    if (!streaming) {
      streaming = true;
      res.status(200);
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      // Proxies that buffer would defeat the point of streaming at all.
      res.setHeader('X-Accel-Buffering', 'no');
    }
    if (!res.writableEnded) res.write(`${JSON.stringify(line)}\n`);
  };

  const cached = await pool.query<{
    content: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    fetched_names: string[] | null;
  }>(
    `SELECT content, model, input_tokens, output_tokens, fetched_names
       FROM ai_reviews
      WHERE user_id = $1 AND feature = $2 AND input_hash = $3`,
    [userId, DECK_REVIEW_FEATURE, inputHash]
  );
  if (cached.rows.length > 0) {
    const row = cached.rows[0];
    send({ delta: row.content });
    send({
      done: {
        content: row.content,
        cached: true,
        model: row.model,
        usage: { inputTokens: row.input_tokens, outputTokens: row.output_tokens },
        ...(row.fetched_names?.length ? { fetched: row.fetched_names } : {}),
      },
    });
    return res.end();
  }

  const limit = user.ai_daily_limit ?? DEFAULT_DAILY_LIMIT;
  const used = await usedToday(userId);
  if (used >= limit) {
    return res.status(429).json({
      error: `Daily limit reached (${limit} per day). It resets at midnight UTC.`,
    });
  }

  // Oracle-text hydration is cache-only by design: a miss means the model
  // reasons without that card's text (the prompt tells it how), never a live
  // Scryfall call from the shared egress IP.
  const cache = getScryfallCache();
  const oracle: OracleEntry[] = [];
  const seen = new Set<string>();
  for (const card of [{ name: request.commander }, ...request.cards]) {
    if (seen.has(card.name)) continue;
    seen.add(card.name);
    const hit = cache.getCheapestByName(card.name);
    if (hit) {
      oracle.push({
        name: hit.name,
        manaCost: hit.mana_cost ?? undefined,
        typeLine: hit.type_line ?? undefined,
        oracleText: hit.oracle_text ?? undefined,
      });
    }
  }

  let generation;
  try {
    generation = await generateReview(
      DECK_REVIEW_SYSTEM_PROMPT,
      buildUserMessage(request, oracle),
      (delta) => send({ delta }),
      ac.signal,
      {
        // Scoped to this deck, so anything the model retrieves is already a
        // legal suggestion for it — the filtering that used to live in the
        // prompt as "stay inside the colour identity" is now in the query.
        tools: [
          lookupCardsTool(cache, {
            colorIdentity: commanderIdentity(cache, request.commander),
            exclude: [request.commander, ...request.cards.map((c) => c.name)],
          }),
        ],
        answerMarker: WEAKNESS_MARK,
      }
    );
  } catch (err) {
    if (err instanceof APIUserAbortError) {
      // The client is gone — nothing to write a row for, nothing to stream to.
      return res.end();
    }
    logger.error('[ai] deck review generation failed', err);
    // Once a delta is out the status line is spent, so the failure has to ride
    // the stream. Nothing is stored, so nothing is charged against the quota
    // and the client's retry is a clean first attempt.
    if (streaming) {
      send({ error: 'The review could not be generated. Try again.' });
      return res.end();
    }
    return res.status(502).json({ error: 'The review could not be generated. Try again.' });
  }

  if (generation.truncated) {
    logger.warn(`[ai] deck review truncated at max_tokens (deckId=${request.deckId})`);
  }

  // The grounding check. A cited card must be in the deck or something the
  // model actually fetched; anything else it recalled from memory. Logged
  // rather than stripped — this is prose, and cutting a name out of a sentence
  // mangles the sentence. It is the same prompt-drift signal deck-refine logs
  // for off-pool names, and the number the live probe reads.
  const unverified = unverifiedCitations(
    generation.content,
    [
      request.commander,
      ...request.cards.map((c) => c.name),
      ...generation.fetched.map((f) => f.name),
    ],
    (name) => cache.getCheapestByName(name, ORACLE_MAX_AGE_MS) !== null
  );
  if (unverified.length > 0) {
    logger.warn(
      `[ai] review cited ${unverified.length} unverified card(s) (deckId=${request.deckId}, ` +
        `promptVersion=${DECK_REVIEW_PROMPT_VERSION}): ${unverified.join(', ')}`
    );
  }

  const fetchedNames = lookedUpNames(generation.fetched);

  await pool.query(
    `INSERT INTO ai_reviews
       (id, user_id, feature, input_hash, model, content, input_tokens, output_tokens, created_at, deck_id, prompt_version, fetched_names)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (user_id, feature, input_hash) DO NOTHING`,
    [
      crypto.randomUUID(),
      userId,
      DECK_REVIEW_FEATURE,
      inputHash,
      AI_MODEL,
      generation.content,
      generation.inputTokens,
      generation.outputTokens,
      Date.now(),
      request.deckId,
      DECK_REVIEW_PROMPT_VERSION,
      JSON.stringify(fetchedNames),
    ]
  );

  send({
    done: {
      content: generation.content,
      cached: false,
      model: AI_MODEL,
      usage: { inputTokens: generation.inputTokens, outputTokens: generation.outputTokens },
      ...(generation.truncated ? { truncated: true } : {}),
      ...(fetchedNames.length ? { fetched: fetchedNames } : {}),
    },
  });
  res.end();
});

/**
 * Distinct names the model looked up, in first-fetch order — stored on the row
 * and sent on `{done}` so the client can chip the cards a reading recommends.
 *
 * `?? []` is not paranoia: this runs after the 200 and the first deltas are
 * out, so a TypeError here would not 500 — it would kill the stream mid-answer
 * and reach the client as a truncated review. The citation check shipped
 * exactly that bug once, from a route-test mock with no `fetched`.
 */
function lookedUpNames(fetched: { name: string }[] | undefined): string[] {
  return [...new Set((fetched ?? []).map((f) => f.name))];
}

/**
 * Cache-only oracle hydration, shared by both features. A miss means the model
 * reasons about that card without its text (the prompts say how) — never a live
 * Scryfall call from the shared egress IP.
 */
function hydrateOracle(names: string[]): OracleEntry[] {
  const cache = getScryfallCache();
  const out: OracleEntry[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    const hit = cache.getCheapestByName(name);
    if (hit) {
      out.push({
        name: hit.name,
        manaCost: hit.mana_cost ?? undefined,
        typeLine: hit.type_line ?? undefined,
        oracleText: hit.oracle_text ?? undefined,
      });
    }
  }
  return out;
}

/**
 * Every distinct card name this user physically owns.
 *
 * Owned-only generation used to be enforced entirely client-side, by filtering
 * the candidate pool before it was submitted. Once the model searches for its
 * own candidates that filter no longer covers anything, so the constraint moves
 * here — where it is also no longer the client's word for it.
 *
 * DISTINCT on the name keeps this proportional to the collection's variety
 * rather than its size: a playset of a card is one row here, and a 20k-card
 * collection is a few thousand names.
 */
async function loadOwnedNames(userId: string): Promise<string[]> {
  const { rows } = await getPool().query<{ name: string }>(
    `SELECT DISTINCT data->>'name' AS name
       FROM user_cards
      WHERE user_id = $1 AND deleted_at IS NULL AND data->>'name' IS NOT NULL`,
    [userId]
  );
  return rows.map((r) => r.name);
}

/**
 * The bracket checker, or nothing at all.
 *
 * Returned as an array so the caller can spread it: when the tag data is
 * missing the tool is simply NOT OFFERED, rather than offered and answering
 * from empty tag sets. That distinction is the whole point — every `TagLookup`
 * predicate returns false on a miss, so a lookup over absent data reports that
 * no deck contains mass land denial, an extra turn, or any role, and hands back
 * a confident bracket that is too low. A model with no bracket tool says
 * nothing; a model with a broken one asserts a wrong number.
 */
function bracketTools(
  request: { cards: { name: string }[]; commander: string },
  cache: ReturnType<typeof getScryfallCache>
): AiTool[] {
  const tags = getTagLookup();
  if (!tags) return [];
  const deckNames = [request.commander, ...request.cards.map((c) => c.name)];
  const inputs = { cache, tags, loadCombos: loadRelevantCombos };
  return [
    checkBracketTool(deckNames, (names) => estimateForNames(names, inputs), renderBracketCheck),
  ];
}

/**
 * Emit only the prose half of a refine reply as it streams.
 *
 * The model writes a marker, then prose, then a delimiter, then JSON. Both the
 * marker and the JSON are machine output and must never flicker across the
 * user's screen, so this drops the opening marker, forwards everything up to
 * the delimiter, and then goes quiet. Deltas split wherever the model happens
 * to chunk, so it holds back a delimiter-length tail rather than risk emitting
 * half of `---TWEAKS---` as if it were prose.
 *
 * The marker arrives here because the tool loop's gate releases text FROM the
 * marker onward — that is what tells it the research is over. Stripping it is
 * this gate's job; `parseRefineOutput` does the same for the stored copy.
 */
function makeProseGate(emit: (text: string) => void): (delta: string) => void {
  let acc = '';
  let sent = 0;
  let done = false;
  let markerHandled = false;
  return (delta: string) => {
    if (done) return;
    acc += delta;
    if (!markerHandled) {
      const markAt = acc.indexOf(STRATEGY_MARK);
      if (markAt !== -1) {
        acc = acc.slice(markAt + STRATEGY_MARK.length).replace(/^\r?\n/, '');
        markerHandled = true;
      } else if (acc.length < STRATEGY_MARK.length) {
        // Could still be the marker arriving a character at a time.
        return;
      } else {
        // No marker in a reply long enough to hold one — a v3-shaped answer.
        markerHandled = true;
      }
    }
    const at = acc.indexOf(TWEAKS_DELIMITER);
    if (at !== -1) {
      if (at > sent) emit(acc.slice(sent, at));
      done = true;
      return;
    }
    const safe = acc.length - TWEAKS_DELIMITER.length;
    if (safe > sent) {
      emit(acc.slice(sent, safe));
      sent = safe;
    }
  };
}

interface RefineDone {
  /** The strategy prose only — the tweaks tail is parsed out. */
  content: string;
  /** Verified against the submitted pool; a hallucinated name never appears. */
  tweaks: RefineTweak[];
  cached: boolean;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  /** Present + true only when the reply was cut off at max_tokens. */
  truncated?: boolean;
  /** Cards the model looked up — see {@link ReviewDone.fetched}. */
  fetched?: string[];
}
type RefineLine = { delta: string } | { done: RefineDone } | { error: string };

// ────────────────────────────────────────────────
// POST /api/ai/deck-refine — the post-generation second pass (T102 slice 4).
// Same consent, same `ai_reviews` table, same daily quota pool as the review;
// only the feature key, the prompt, and the verified tweak list differ.
//
// The stored row holds the RAW model reply, tail and all, so a cache hit
// re-verifies the tweaks against the pool it is being replayed for rather than
// trusting a parse from an earlier request.
// ────────────────────────────────────────────────
aiRouter.post('/deck-refine', reviewLimiter, requireAuth, async (req: Request, res: Response) => {
  const parsed = parseRefineRequest(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const request = parsed.value;
  const userId = req.user!.id;

  const user = await loadAiUser(userId);
  if (!user.ai_opt_in) {
    return res.status(403).json({ error: 'AI features are not enabled for this account.' });
  }

  const inputHash = hashRefineInput(request);
  const pool = getPool();

  res.on('error', () => {});
  const ac = new AbortController();
  req.on('close', () => {
    if (!res.writableEnded) ac.abort();
  });
  let streaming = false;
  const send = (line: RefineLine) => {
    if (!streaming) {
      streaming = true;
      res.status(200);
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Accel-Buffering', 'no');
    }
    if (!res.writableEnded) res.write(`${JSON.stringify(line)}\n`);
  };

  // What the model may propose beyond the engine's list. Built BEFORE the cache
  // check on purpose: a stored reply is re-verified when it is replayed, and
  // without the resolver every card the model looked up would verify on the
  // first read and vanish on the second.
  const cache = getScryfallCache();
  const ownedNames = request.ownedOnly ? await loadOwnedNames(userId) : undefined;
  const searchContext = {
    colorIdentity: commanderIdentity(cache, request.commander),
    exclude: [request.commander, ...request.cards.map((c) => c.name)],
    ownedNames,
  };
  const resolveCandidate = makeCandidateResolver(cache, searchContext);

  const cached = await pool.query<{
    content: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    fetched_names: string[] | null;
  }>(
    `SELECT content, model, input_tokens, output_tokens, fetched_names
       FROM ai_reviews
      WHERE user_id = $1 AND feature = $2 AND input_hash = $3`,
    [userId, DECK_REFINE_FEATURE, inputHash]
  );
  if (cached.rows.length > 0) {
    const row = cached.rows[0];
    const out = parseRefineOutput(row.content, request, resolveCandidate);
    send({ delta: out.strategy });
    send({
      done: {
        content: out.strategy,
        tweaks: out.tweaks,
        cached: true,
        model: row.model,
        usage: { inputTokens: row.input_tokens, outputTokens: row.output_tokens },
        ...(row.fetched_names?.length ? { fetched: row.fetched_names } : {}),
      },
    });
    return res.end();
  }

  const limit = user.ai_daily_limit ?? DEFAULT_DAILY_LIMIT;
  const used = await usedToday(userId);
  if (used >= limit) {
    return res.status(429).json({
      error: `Daily limit reached (${limit} per day). It resets at midnight UTC.`,
    });
  }

  // The engine's suggestions need hydrating too — the model can't judge a
  // candidate it only knows the name of. Cards it looks up arrive with their
  // oracle text already attached, so they need nothing here.
  const oracle = hydrateOracle([
    request.commander,
    ...request.cards.map((c) => c.name),
    ...request.pool.map((c) => c.name),
  ]);

  let generation;
  try {
    generation = await generateReview(
      DECK_REFINE_SYSTEM_PROMPT,
      buildRefineMessage(request, oracle),
      makeProseGate((text) => send({ delta: text })),
      ac.signal,
      {
        // Same deck scoping as the review, plus the owned-only restriction:
        // under an owned-only build a card the player would have to buy is not
        // a suggestion, so it never enters the search results at all.
        tools: [lookupCardsTool(cache, searchContext), ...bracketTools(request, cache)],
        answerMarker: STRATEGY_MARK,
      }
    );
  } catch (err) {
    if (err instanceof APIUserAbortError) {
      return res.end();
    }
    logger.error('[ai] deck refine generation failed', err);
    if (streaming) {
      send({ error: 'The refine pass could not be generated. Try again.' });
      return res.end();
    }
    return res.status(502).json({ error: 'The refine pass could not be generated. Try again.' });
  }

  if (generation.truncated) {
    logger.warn(`[ai] deck refine truncated at max_tokens (deckId=${request.deckId})`);
  }

  const out = parseRefineOutput(generation.content, request, resolveCandidate);
  // Rejected names mean the prompt's grounding rule slipped. They never reach
  // the user, but they're the signal that the prompt needs another eval run.
  if (out.rejected.length > 0) {
    logger.warn(`[ai] deck refine proposed ${out.rejected.length} unusable card(s)`, out.rejected);
  }
  // Provenance, as a drift signal only — the enforced check is legality, since
  // that is the one a cache replay can recompute. A tweak the model never
  // looked up is a real card it recalled rather than read, which is exactly
  // the habit the tool exists to replace.
  // `?? []` is not paranoia: this runs AFTER the 200 and the first deltas are
  // out, so a TypeError here doesn't 500 — it kills the stream mid-answer and
  // surfaces to the client as a truncated review. The review's citation check
  // shipped exactly that bug once.
  const grounded = new Set([
    ...request.pool.map((c) => c.name.toLowerCase()),
    ...(generation.fetched ?? []).map((f) => f.name.toLowerCase()),
  ]);
  const recalled = out.tweaks.map((t) => t.add).filter((n) => !grounded.has(n.toLowerCase()));
  if (recalled.length > 0) {
    logger.warn(
      `[ai] deck refine proposed ${recalled.length} card(s) it never looked up ` +
        `(deckId=${request.deckId}, promptVersion=${DECK_REFINE_PROMPT_VERSION}): ${recalled.join(', ')}`
    );
  }

  const fetchedNames = lookedUpNames(generation.fetched);

  await pool.query(
    `INSERT INTO ai_reviews
       (id, user_id, feature, input_hash, model, content, input_tokens, output_tokens, created_at, deck_id, prompt_version, fetched_names)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (user_id, feature, input_hash) DO NOTHING`,
    [
      crypto.randomUUID(),
      userId,
      DECK_REFINE_FEATURE,
      inputHash,
      AI_MODEL,
      generation.content,
      generation.inputTokens,
      generation.outputTokens,
      Date.now(),
      request.deckId,
      DECK_REFINE_PROMPT_VERSION,
      JSON.stringify(fetchedNames),
    ]
  );

  send({
    done: {
      content: out.strategy,
      tweaks: out.tweaks,
      cached: false,
      model: AI_MODEL,
      usage: { inputTokens: generation.inputTokens, outputTokens: generation.outputTokens },
      ...(generation.truncated ? { truncated: true } : {}),
      ...(fetchedNames.length ? { fetched: fetchedNames } : {}),
    },
  });
  res.end();
});
