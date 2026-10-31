import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { APIUserAbortError } from '@anthropic-ai/sdk';
import { logger } from '../logger';
import { loadAuthedUser, readSessionCookie, requireAuth } from '../auth';
import { getPool } from '../db';
import { loadOwnedNames } from '../ai/owned-names';
import { deckSnapshot, type Grounding } from '../ai/grounding';
import { testAwareLimiter } from '../route-utils';
import { getScryfallCache } from '../scryfall-cache';
import type { PriceCeiling } from '../cache';
import { cardFaceText } from '../card-text';
import type { ScryfallCard } from '../types';
import { aiEnabled, generateReview, REFINE_MODEL, REVIEW_GENERATION } from '../ai/client';
import { aiDailyUsdCap, spentTodayUsd } from '../ai/spend';
import { plainDashes, plainDashStream } from '../ai/plain-dashes';
import {
  checkBracketTool,
  lookupCardsTool,
  makeCandidateResolver,
  withinBudget,
  type AiTool,
} from '../ai/tools';
import { getTagLookup } from '../ai/tags';
import { estimateForNames, renderBracketCheck } from '../ai/bracket';
import { backendOracleTagLookup } from '../ai/otag-lookup';
import { loadRelevantCombos } from './combos';
import {
  DECK_REVIEW_FEATURE,
  DECK_REVIEW_PROMPT_VERSION,
  DECK_REVIEW_RESEARCH_PROMPT,
  DECK_REVIEW_SYSTEM_PROMPT,
  END_MARK,
  WEAKNESS_MARK,
  buildUserMessage,
  commandZone,
  hashDeckReviewInput,
  parseDeckReviewRequest,
  renderFetchedCards,
  unverifiedCitations,
  BUDGET_CEILING,
  isCollectionScope,
  type AiScope,
  type OracleEntry,
  type PriceCurrency,
} from '../ai/deck-review';
import {
  DECK_REFINE_FEATURE,
  DECK_REFINE_PROMPT_VERSION,
  DECK_REFINE_SYSTEM_PROMPT,
  STRATEGY_MARK,
  buildRefineMessage,
  hashRefineInput,
  parseRefineOutput,
  parseRefineRequest,
  suggestedAsDeck,
  withTweaks,
  type RefineTweak,
} from '../ai/deck-refine';
import { checkRefineWhys } from '../ai/why-check';
import { checkedRefineProse, makeProseGate } from '../ai/prose-check';

/**
 * Oracle facts don't expire the way prices do, so card lookups that only read
 * name/type/text ignore the cache's 7-day TTL — the same reasoning
 * `getMany`'s `allowStale` documents. Never read a price off one of these.
 */
const ORACLE_MAX_AGE_MS = Number.MAX_SAFE_INTEGER;

/**
 * The command zone's color identity (both partners, unioned), so card search
 * only returns cards this deck could legally run. A miss on either commander
 * returns undefined, which searches unrestricted — better a wider search than
 * one missing a partner's colors, and the prompt still states the rule.
 */
function commanderIdentity(
  cache: ReturnType<typeof getScryfallCache>,
  commanders: string[]
): string[] | undefined {
  const identity = new Set<string>();
  for (const name of commanders) {
    const colors = cache.getCheapestByName(name, ORACLE_MAX_AGE_MS)?.color_identity;
    if (!colors) return undefined;
    for (const c of colors) identity.add(c);
  }
  return [...identity];
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
/**
 * How long a stored reading of an unchanged deck is protected from a forced
 * re-read ("Read again"). Measured from the reading's own `created_at` on the
 * server clock; a content or prompt-version change is a different cache key and
 * never meets this window. A forced re-read spends one unit of the same daily
 * quota and the same global USD cap as any fresh reading.
 */
export const REREAD_WINDOW_MS = 24 * 60 * 60 * 1000;

const reviewLimiter = testAwareLimiter({ windowMs: 60_000, max: 10 });
const optInLimiter = testAwareLimiter({ windowMs: 60_000, max: 20 });
const aiReadLimiter = testAwareLimiter({ windowMs: 60_000, max: 60 });

/**
 * Feature flag: while the AI features are experimental they are admin-only,
 * so they can't be abused before the quota/prompt story is proven out. Set
 * `AI_PUBLIC=1` to open them to every account. Read fresh per request (like
 * `ADMIN_EMAILS`) so flipping the env var needs no rebuild.
 */
const aiPublic = (): boolean => process.env.AI_PUBLIC === '1';

async function hasAiAccess(userId: string): Promise<boolean> {
  const res = await getPool().query<{ ai_access: boolean }>(
    'SELECT ai_access FROM users WHERE id = $1',
    [userId]
  );
  return res.rows[0]?.ai_access === true;
}

/**
 * Gate ladder: admin, or `AI_PUBLIC=1`, or a per-user unlock an admin granted
 * from the panel (T114, `users.ai_access`). The user's own opt-in consent is
 * checked separately by each route — this only decides who can see the door.
 */
aiRouter.use(async (req: Request, res: Response, next) => {
  if (!aiEnabled()) return res.status(404).json({ error: 'Not found.' });
  if (aiPublic()) return next();
  // Everyone else gets the same 404 as an unconfigured backend: the client
  // treats 404 as "feature unavailable" and renders nothing, so the UI hides
  // itself and the endpoints aren't advertised.
  const token = readSessionCookie(req);
  const user = token ? await loadAuthedUser(token) : null;
  if (!user) return res.status(404).json({ error: 'Not found.' });
  if (user.role === 'admin' || (await hasAiAccess(user.id))) return next();
  res.status(404).json({ error: 'Not found.' });
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

/** Why a fresh generation can't run right now, or null when it can. */
async function dailyQuotaError(userId: string, userLimit: number | null): Promise<string | null> {
  const limit = userLimit ?? DEFAULT_DAILY_LIMIT;
  if ((await usedToday(userId)) >= limit) {
    return `Daily limit reached (${limit} per day). It resets at midnight UTC.`;
  }
  if ((await spentTodayUsd()) >= aiDailyUsdCap()) {
    logger.warn(
      '[ai] global daily spend cap reached; refusing fresh generations until UTC midnight'
    );
    return 'AI is at its limit for today. It resets at midnight UTC.';
  }
  return null;
}

// ────────────────────────────────────────────────
// GET /api/ai/status — everything the UI needs to gate itself:
// opt-in state, today's usage, and the effective daily limit.
// (404 from the router guard = the feature is unavailable entirely.)
// ────────────────────────────────────────────────
aiRouter.get('/status', requireAuth, aiReadLimiter, async (req: Request, res: Response) => {
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
aiRouter.get('/history', requireAuth, aiReadLimiter, async (req: Request, res: Response) => {
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
      content: plainDashes(r.content),
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
  /** When the stored reading was written (server clock, epoch ms). */
  createdAt: number;
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
    created_at: string | number;
  }>(
    `SELECT content, model, input_tokens, output_tokens, fetched_names, created_at
       FROM ai_reviews
      WHERE user_id = $1 AND feature = $2 AND input_hash = $3`,
    [userId, DECK_REVIEW_FEATURE, inputHash]
  );
  // `refresh` asks for a fresh reading of a deck whose stored reading still
  // matches. It is honoured once per window; the old row stays until the new
  // one is written, so a failed generation costs the reader nothing.
  const refresh = (req.body as { refresh?: unknown } | undefined)?.refresh === true;
  if (cached.rows.length > 0 && refresh) {
    const availableAt = Number(cached.rows[0].created_at) + REREAD_WINDOW_MS;
    if (Date.now() < availableAt) {
      return res
        .status(409)
        .json({ error: 'This deck was read recently. Try again later.', availableAt });
    }
  } else if (cached.rows.length > 0) {
    const row = cached.rows[0];
    const content = plainDashes(row.content);
    send({ delta: content });
    send({
      done: {
        content,
        cached: true,
        createdAt: Number(row.created_at),
        model: row.model,
        usage: { inputTokens: row.input_tokens, outputTokens: row.output_tokens },
        ...(row.fetched_names?.length ? { fetched: row.fetched_names } : {}),
      },
    });
    return res.end();
  }

  const quotaError = await dailyQuotaError(userId, user.ai_daily_limit);
  if (quotaError) return res.status(429).json({ error: quotaError });

  // Oracle-text hydration is cache-only by design: a miss means the model
  // reasons without that card's text (the prompt tells it how), never a live
  // Scryfall call from the shared egress IP.
  const cache = getScryfallCache();
  // The review's search honors the same deck-scoped sources contract as the
  // refine pass, so a restricted deck is never prescribed a card to buy.
  const scoped = await scopeSearch(userId, request.scope, request.deckId, request.currency);
  const oracle = hydrateOracle([...commandZone(request), ...request.cards.map((c) => c.name)]);

  // TWO PASSES: research, then write.
  //
  // They used to be one tool-using call, and the marker gate had to tell the
  // model's research narration apart from the review inside a single stream.
  // Its rule — a markerless turn that ended in a tool call is research — is
  // only true if the model never searches mid-answer, and measured on the raw
  // stream it does: it emits a section label, THEN searches, so section bodies
  // arrived in markerless turns and were thrown away as research. Neither a
  // firmer prompt nor `tool_choice: none` fixed that (both measured; see
  // `createMarkerGate`).
  //
  // Splitting the passes makes the rule unnecessary rather than true. Pass 1
  // has tools and its prose is discarded wholesale. Pass 2 has NO tools, so
  // there is nothing to narrate toward, no turn boundary to lose a body at, and
  // no denied tool to fake — every byte it writes is answer.
  const userMessage = buildUserMessage(request, oracle);
  let generation;
  try {
    // Pass 1 — research. No `onDelta`: the reader sees none of this.
    const research = await generateReview(
      DECK_REVIEW_RESEARCH_PROMPT,
      userMessage,
      undefined,
      ac.signal,
      {
        ...REVIEW_GENERATION,
        // Scoped to this deck, so anything the model retrieves is already a
        // legal suggestion for it — the filtering that used to live in the
        // prompt as "stay inside the color identity" is now in the query.
        tools: [
          lookupCardsTool(cache, {
            colorIdentity: commanderIdentity(cache, commandZone(request)),
            exclude: [...commandZone(request), ...request.cards.map((c) => c.name)],
            format: request.format,
            ...scoped,
          }),
        ],
      }
    );

    // Pass 2 — write. The research pass's CARDS carry over; its prose does not.
    const found = renderFetchedCards(research.fetched, request.scope, request.currency);
    const prose = plainDashStream((delta) => send({ delta }));
    generation = await generateReview(
      DECK_REVIEW_SYSTEM_PROMPT,
      found ? `${userMessage}\n\n${found}` : userMessage,
      prose.push,
      ac.signal,
      { ...REVIEW_GENERATION, answerMarker: WEAKNESS_MARK, endMarker: END_MARK }
    );
    prose.flush();
    // Bill both passes, and keep the research pass's cards as the citation
    // allowlist — pass 2 has no tools, so its own `fetched` is always empty.
    generation = {
      ...generation,
      fetched: research.fetched,
      inputTokens: generation.inputTokens + research.inputTokens,
      outputTokens: generation.outputTokens + research.outputTokens,
    };
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
      ...commandZone(request),
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
  const grounding: Grounding = {
    unverified,
    ...(generation.truncated ? { truncated: true } : {}),
  };

  const now = Date.now();
  // A forced re-read replaces the stored row in place (one row per key), so
  // the quota meter and spend ledger count it as a fresh generation: the old
  // row is >= 24h old, hence from an earlier UTC day. The WHERE keeps two racing
  // re-reads from both landing.
  await pool.query(
    `INSERT INTO ai_reviews
       (id, user_id, feature, input_hash, model, content, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, created_at, deck_id, prompt_version, fetched_names, grounding, deck_snapshot)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     ON CONFLICT (user_id, feature, input_hash) ${
       refresh
         ? `DO UPDATE SET model = EXCLUDED.model, content = EXCLUDED.content,
              input_tokens = EXCLUDED.input_tokens, output_tokens = EXCLUDED.output_tokens,
              cache_write_tokens = EXCLUDED.cache_write_tokens,
              cache_read_tokens = EXCLUDED.cache_read_tokens, created_at = EXCLUDED.created_at,
              deck_id = EXCLUDED.deck_id, prompt_version = EXCLUDED.prompt_version,
              fetched_names = EXCLUDED.fetched_names, grounding = EXCLUDED.grounding,
              deck_snapshot = EXCLUDED.deck_snapshot
            WHERE ai_reviews.created_at <= $17`
         : 'DO NOTHING'
     }`,
    [
      crypto.randomUUID(),
      userId,
      DECK_REVIEW_FEATURE,
      inputHash,
      REVIEW_GENERATION.model,
      generation.content,
      generation.inputTokens,
      generation.outputTokens,
      generation.cacheWriteTokens ?? 0,
      generation.cacheReadTokens ?? 0,
      now,
      request.deckId,
      DECK_REVIEW_PROMPT_VERSION,
      JSON.stringify(fetchedNames),
      JSON.stringify(grounding),
      JSON.stringify(deckSnapshot(request)),
      ...(refresh ? [now - REREAD_WINDOW_MS] : []),
    ]
  );

  send({
    done: {
      content: plainDashes(generation.content),
      cached: false,
      createdAt: now,
      model: REVIEW_GENERATION.model,
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
 * One card as the model reads it. Multi-face cards carry their text per face, so
 * this joins them with each face's name ("Front: text // Back: text") through the
 * same helper the search index uses. Exported for the guard test.
 */
export function oracleEntry(card: ScryfallCard): OracleEntry {
  const { manaCost, typeLine, oracleText } = cardFaceText(card, { labelFaces: true });
  return {
    name: card.name,
    manaCost: manaCost || undefined,
    typeLine: typeLine || undefined,
    oracleText: oracleText || undefined,
  };
}

/**
 * Cache-only oracle hydration, shared by both features. A miss means the model
 * reasons about that card without its text (the prompts say how) — never a live
 * Scryfall call from the shared egress IP.
 *
 * Read at ORACLE_MAX_AGE_MS, not the cache's default 7-day TTL: that TTL exists
 * because prices move, and rules text doesn't. Under the default, a deck card
 * nobody had looked up for a week silently lost its text, and the model was
 * left judging it by its name.
 */
function hydrateOracle(names: string[]): OracleEntry[] {
  const cache = getScryfallCache();
  const out: OracleEntry[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    const hit = cache.getCheapestByName(name, ORACLE_MAX_AGE_MS);
    if (hit) {
      out.push(oracleEntry(hit));
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
/**
 * The search restriction a deck's AI scope imposes, in the shape both
 * `lookupCardsTool` and `makeCandidateResolver` take. One place, so the review
 * and the refine pass cannot read the contract differently.
 */
async function scopeSearch(
  userId: string,
  scope: AiScope,
  deckId: string,
  currency: PriceCurrency
): Promise<{ ownedNames?: string[]; notOwnedNames?: string[]; maxPrice?: PriceCeiling }> {
  if (isCollectionScope(scope)) return { ownedNames: await loadOwnedNames(userId, scope, deckId) };
  if (scope === 'unowned') return { notOwnedNames: await loadOwnedNames(userId, 'owned', deckId) };
  if (scope === 'budget') return { maxPrice: { amount: BUDGET_CEILING, currency } };
  return {};
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
  request: { cards: { name: string }[]; commander: string; partnerCommander?: string },
  cache: ReturnType<typeof getScryfallCache>
): AiTool[] {
  const tags = getTagLookup();
  if (!tags) return [];
  const commanders = commandZone(request);
  const deckNames = [...commanders, ...request.cards.map((c) => c.name)];
  const inputs = {
    cache,
    tags,
    loadCombos: loadRelevantCombos,
    commanderNames: commanders,
    oracleTags: backendOracleTagLookup(),
  };
  return [
    checkBracketTool(deckNames, (names) => estimateForNames(names, inputs), renderBracketCheck),
  ];
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
type RefineLine = { delta: string } | { checking: true } | { done: RefineDone } | { error: string };

const plainWhys = (tweaks: RefineTweak[]) => tweaks.map((t) => ({ ...t, why: plainDashes(t.why) }));

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
  const scoped = await scopeSearch(userId, request.scope, request.deckId, request.currency);
  const searchContext = {
    colorIdentity: commanderIdentity(cache, commandZone(request)),
    exclude: [...commandZone(request), ...request.cards.map((c) => c.name)],
    format: request.format,
    ...scoped,
  };
  const resolveCandidate = makeCandidateResolver(cache, searchContext);
  // The engine's pool is the one source the parser trusts without the
  // resolver, so under a budget it is trimmed here — AFTER the hash, so a
  // price crossing the ceiling overnight re-verifies the stored answer rather
  // than spending a new reading on it.
  if (scoped.maxPrice) {
    const ceiling = scoped.maxPrice;
    request.pool = request.pool.filter((c) => withinBudget(cache, c.name, ceiling));
  }
  // Same for "Cards I don't own": the engine's list leans on the collection
  // (substitutes, owned upgrades), and every owned name in it would be a
  // suggestion the player asked not to get.
  if (scoped.notOwnedNames) {
    const owned = new Set(scoped.notOwnedNames.map((n) => n.toLowerCase()));
    request.pool = request.pool.filter((c) => !owned.has(c.name.toLowerCase()));
  }

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
    const strategy = plainDashes(out.strategy);
    send({ delta: strategy });
    send({
      done: {
        content: strategy,
        tweaks: plainWhys(out.tweaks),
        cached: true,
        model: row.model,
        usage: { inputTokens: row.input_tokens, outputTokens: row.output_tokens },
        ...(row.fetched_names?.length ? { fetched: row.fetched_names } : {}),
      },
    });
    return res.end();
  }

  const quotaError = await dailyQuotaError(userId, user.ai_daily_limit);
  if (quotaError) return res.status(429).json({ error: quotaError });

  // The engine's suggestions need hydrating too — the model can't judge a
  // candidate it only knows the name of. Cards it looks up arrive with their
  // oracle text already attached, so they need nothing here.
  const oracle = hydrateOracle([
    ...commandZone(request),
    ...request.cards.map((c) => c.name),
    ...request.pool.map((c) => c.name),
  ]);

  // The strategy is checked a paragraph at a time and streams only once checked
  // (E1029), so nothing the reader has seen is ever taken back.
  const shown = plainDashStream((text) => send({ delta: text }));
  const prose = checkedRefineProse(request, oracle, ac.signal, shown.push);
  let generation;
  try {
    generation = await generateReview(
      DECK_REFINE_SYSTEM_PROMPT,
      buildRefineMessage(request, oracle),
      makeProseGate(prose.push),
      ac.signal,
      {
        // Same deck scoping as the review, plus the owned-only restriction:
        // under an owned-only build a card the player would have to buy is not
        // a suggestion, so it never enters the search results at all.
        tools: [lookupCardsTool(cache, searchContext), ...bracketTools(request, cache)],
        answerMarker: STRATEGY_MARK,
        model: REFINE_MODEL,
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

  // Every "why" is checked against the card text (E1027) while the prose's last
  // sentences finish theirs; the client is told the wait after the prose is the check.
  const swaps = out.tweaks.length
    ? checkRefineWhys(
        request,
        out.tweaks,
        [...oracle, ...(generation.fetched ?? []), ...hydrateOracle(out.tweaks.map((t) => t.add))],
        ac.signal
      )
    : null;
  swaps?.catch(() => {});
  const raw = out.strategy;
  let checked, run;
  try {
    checked = await prose.finish(raw);
    shown.flush();
    if (swaps) send({ checking: true });
    run = await swaps;
  } catch (err) {
    if (err instanceof APIUserAbortError || ac.signal.aborted) return res.end();
    throw err;
  }
  out.strategy = checked.strategy;
  if (run) out.tweaks = run.tweaks;
  const whyCheck = run?.grounding;
  const checkUsage = { ...checked.usage };
  for (const k of Object.keys(checkUsage) as (keyof typeof checkUsage)[])
    checkUsage[k] += run?.usage[k] ?? 0;

  // Rejected names mean the prompt's grounding rule slipped. They never reach
  // the user, but they're the signal that the prompt needs another eval run.
  if (out.rejected.length > 0) {
    logger.warn(`[ai] deck refine proposed ${out.rejected.length} unusable card(s)`, out.rejected);
  }
  // A cut of an engine source/payoff is refused the same way — the prompt's
  // "cut a weak slot" rule slipped, and the piece never leaves the deck.
  if (out.protectedCuts.length > 0) {
    logger.warn(
      `[ai] deck refine tried to cut ${out.protectedCuts.length} engine piece(s) (deckId=${request.deckId})`,
      out.protectedCuts
    );
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
  // The review's citation check, run over refine's prose too: the strategy and
  // every "why". Until this ran, a "why" could name a card the deck doesn't run
  // as if it did, and nothing looked.
  const unverified = unverifiedCitations(
    [out.strategy, ...out.tweaks.map((t) => t.why)].join('\n'),
    [
      ...commandZone(request),
      ...request.cards.map((c) => c.name),
      ...request.pool.map((c) => c.name),
      ...(generation.fetched ?? []).map((f) => f.name),
      ...out.tweaks.flatMap((t) => (t.cut ? [t.add, t.cut] : [t.add])),
    ],
    (name) => cache.getCheapestByName(name, ORACLE_MAX_AGE_MS) !== null
  );
  if (unverified.length > 0) {
    logger.warn(
      `[ai] deck refine cited ${unverified.length} unverified card(s) (deckId=${request.deckId}, ` +
        `promptVersion=${DECK_REFINE_PROMPT_VERSION}): ${unverified.join(', ')}`
    );
  }

  const fetchedNames = lookedUpNames(generation.fetched);
  const grounding: Grounding = {
    unverified,
    recalled,
    rejected: out.rejected,
    protectedCuts: out.protectedCuts,
    suggestedAsDeck: suggestedAsDeck(raw, request, generation.fetched),
    ...(whyCheck ? { whyCheck } : {}),
    proseCheck: checked.grounding,
    ...(generation.truncated ? { truncated: true } : {}),
  };
  // Stored CHECKED, prose and tail, so a cache hit replays only what passed;
  // what was dropped, and why, is in `grounding.proseCheck` and `.whyCheck`.
  const inputTokens = generation.inputTokens + checkUsage.inputTokens;
  const outputTokens = generation.outputTokens + checkUsage.outputTokens;

  await pool.query(
    `INSERT INTO ai_reviews
       (id, user_id, feature, input_hash, model, content, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, created_at, deck_id, prompt_version, fetched_names, grounding, deck_snapshot)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     ON CONFLICT (user_id, feature, input_hash) DO NOTHING`,
    [
      crypto.randomUUID(),
      userId,
      DECK_REFINE_FEATURE,
      inputHash,
      REFINE_MODEL,
      withTweaks(generation.content, out.tweaks, out.strategy),
      inputTokens,
      outputTokens,
      (generation.cacheWriteTokens ?? 0) + checkUsage.cacheWriteTokens,
      (generation.cacheReadTokens ?? 0) + checkUsage.cacheReadTokens,
      Date.now(),
      request.deckId,
      DECK_REFINE_PROMPT_VERSION,
      JSON.stringify(fetchedNames),
      JSON.stringify(grounding),
      JSON.stringify(deckSnapshot(request)),
    ]
  );

  send({
    done: {
      content: plainDashes(out.strategy),
      tweaks: plainWhys(out.tweaks),
      cached: false,
      model: REFINE_MODEL,
      usage: { inputTokens, outputTokens },
      ...(generation.truncated ? { truncated: true } : {}),
      ...(fetchedNames.length ? { fetched: fetchedNames } : {}),
    },
  });
  res.end();
});
