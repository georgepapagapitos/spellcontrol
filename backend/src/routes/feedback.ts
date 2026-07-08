import crypto from 'crypto';
import { Router, type Request, type Response } from 'express';
import { and, count, desc, eq } from 'drizzle-orm';
import { optionalAuth, requireAuth } from '../auth';
import { getDb } from '../db';
import { deckFeedback } from '../db/schema';
import { areFriends } from '../friends/relations';
import { loadShareContext } from '../shares/context';
import { findDeckById } from '../shares/projections';
import { testAwareLimiter } from '../route-utils';

/**
 * The Feedback Tool (BlueprintMTG-style). A deck owner mints a kind='feedback'
 * share (routes/shares.ts); anyone opening that link gets a suggestion-mode
 * deck view where they can propose cuts (any card in the list) and adds (via
 * card search), attach an overall comment and a power-bracket read, and
 * submit — signed in or as a guest. The owner reviews responses per deck and
 * accepts/rejects each suggestion; applying accepted changes happens client-
 * side through the normal deck-store mutations, so it syncs like any edit.
 */
export const feedbackRouter: Router = Router();

const submitLimiter = testAwareLimiter({ windowMs: 60_000, max: 10 });

const NAME_MAX = 40;
const COMMENT_MAX = 4000;
const CARD_NAME_MAX = 200;
const MAX_SUGGESTIONS = 60;
/** Full Scryfall card blobs ride along on 'add' suggestions so the owner can
 *  apply one without a lookup; cap the serialized size so a hostile client
 *  can't stash megabytes per row (the JSON body limit is a shared 72mb). */
const CARD_JSON_MAX = 64 * 1024;
/** Abuse bound per feedback link, mirroring game nights' MAX_RSVPS — a
 *  low-and-slow guest can't grow one owner's deck_feedback rows unboundedly. */
const MAX_RESPONSES = 64;

export type SuggestionStatus = 'pending' | 'accepted' | 'rejected';

export interface FeedbackSuggestion {
  id: string;
  type: 'add' | 'cut';
  cardName: string;
  scryfallId?: string;
  oracleId?: string;
  imageUrl?: string;
  /** Full Scryfall card JSON for adds — lets the owner apply instantly. */
  card?: unknown;
  status: SuggestionStatus;
}

function cleanString(x: unknown, max: number): string | null {
  if (typeof x !== 'string') return null;
  const trimmed = x.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function optionalCleanString(x: unknown, max: number): string | undefined {
  return cleanString(x, max) ?? undefined;
}

/** Parse and sanitize the submitted suggestion list; null = invalid payload. */
function parseSuggestions(raw: unknown): FeedbackSuggestion[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_SUGGESTIONS) return null;
  const out: FeedbackSuggestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const s = item as Record<string, unknown>;
    if (s.type !== 'add' && s.type !== 'cut') return null;
    const cardName = cleanString(s.cardName, CARD_NAME_MAX);
    if (!cardName) return null;
    let card: unknown;
    if (s.type === 'add' && s.card && typeof s.card === 'object') {
      // Reject, don't silently drop — a stripped card would look like a bug
      // to the responder ("apply instantly" gone) with no error anywhere.
      if (JSON.stringify(s.card).length > CARD_JSON_MAX) return null;
      card = s.card;
    }
    out.push({
      id: crypto.randomUUID(),
      type: s.type,
      cardName,
      scryfallId: optionalCleanString(s.scryfallId, 100),
      oracleId: optionalCleanString(s.oracleId, 100),
      imageUrl: optionalCleanString(s.imageUrl, 500),
      card,
      status: 'pending',
    });
  }
  return out;
}

function readParam(req: Request, name: string): string {
  const raw = req.params[name];
  return typeof raw === 'string' ? raw : raw[0];
}

/**
 * Submit a feedback response against a feedback share. Mirrors the public
 * share read's audience gates (link/friends/direct) so a friends-only
 * feedback link can't be written to by strangers either. Guests must supply
 * a display name; authed callers default to their username.
 */
feedbackRouter.post(
  '/public/:token',
  submitLimiter,
  optionalAuth,
  async (req: Request, res: Response) => {
    const token = readParam(req, 'token');
    const ctx = await loadShareContext(token);
    if (!ctx || ctx.share.kind !== 'feedback') {
      return res.status(404).json({ error: 'Feedback link not found.' });
    }
    const { share } = ctx;

    if (share.audience === 'friends') {
      if (!req.user) {
        return res.status(401).json({ error: 'Sign in to give feedback on this deck.' });
      }
      if (!(await areFriends(req.user.id, share.userId))) {
        return res.status(403).json({ error: 'This feedback link is for the owner’s friends.' });
      }
    } else if (share.audience === 'direct') {
      if (!req.user) {
        return res.status(401).json({ error: 'Sign in to give feedback on this deck.' });
      }
      if (!share.addresseeId || req.user.id !== share.addresseeId) {
        return res.status(404).json({ error: 'Feedback link not found.' });
      }
    }

    // The deck must still exist — a dangling share reads as 404, same as the
    // public share view.
    if (!findDeckById(ctx.data.decks, share.resourceId)) {
      return res.status(404).json({ error: 'Feedback link not found.' });
    }

    // ponytail: hard cap, no pagination — no deck accrues more real feedback
    // than this; it exists purely so anonymous writes can't grow unboundedly.
    const [existing] = await getDb()
      .select({ n: count() })
      .from(deckFeedback)
      .where(eq(deckFeedback.shareToken, share.token));
    if (existing.n >= MAX_RESPONSES) {
      return res.status(400).json({ error: 'This feedback link is full.' });
    }

    const body = req.body as Record<string, unknown>;
    const suggestions = parseSuggestions(body.suggestions ?? []);
    if (!suggestions) {
      return res.status(400).json({ error: 'suggestions must be a valid list of adds and cuts.' });
    }
    const comment = cleanString(body.comment, COMMENT_MAX) ?? '';
    if (suggestions.length === 0 && !comment) {
      return res.status(400).json({ error: 'Add at least one suggestion or a comment.' });
    }
    let bracketSuggestion: number | null = null;
    if (body.bracketSuggestion !== undefined && body.bracketSuggestion !== null) {
      const b = body.bracketSuggestion;
      if (typeof b !== 'number' || !Number.isInteger(b) || b < 1 || b > 5) {
        return res.status(400).json({ error: 'bracketSuggestion must be an integer from 1 to 5.' });
      }
      bracketSuggestion = b;
    }
    const authorName = req.user
      ? (cleanString(body.authorName, NAME_MAX) ?? req.user.username)
      : cleanString(body.authorName, NAME_MAX);
    if (!authorName) {
      return res.status(400).json({ error: `Name is required (max ${NAME_MAX} characters).` });
    }

    const now = Date.now();
    const row = {
      id: crypto.randomUUID(),
      shareToken: share.token,
      ownerUserId: share.userId,
      deckId: share.resourceId,
      authorUserId: req.user?.id ?? null,
      authorName,
      comment,
      bracketSuggestion,
      suggestions,
      createdAt: now,
      updatedAt: now,
    };
    await getDb().insert(deckFeedback).values(row);
    res.status(201).json({ feedback: { id: row.id } });
  }
);

/** List feedback responses for one of the caller's decks, newest first. */
feedbackRouter.get('/deck/:deckId', requireAuth, async (req: Request, res: Response) => {
  const deckId = readParam(req, 'deckId');
  const rows = await getDb()
    .select()
    .from(deckFeedback)
    .where(and(eq(deckFeedback.ownerUserId, req.user!.id), eq(deckFeedback.deckId, deckId)))
    .orderBy(desc(deckFeedback.createdAt));
  res.json({
    responses: rows.map((r) => ({
      id: r.id,
      authorName: r.authorName,
      authorUserId: r.authorUserId,
      comment: r.comment,
      bracketSuggestion: r.bracketSuggestion,
      suggestions: r.suggestions,
      createdAt: r.createdAt,
    })),
  });
});

/**
 * Owner verdict on one suggestion: accepted / rejected (or back to pending —
 * an accidental tap must be reversible). The actual deck edit happens client-
 * side; this just records the decision so every device shows the same state.
 */
feedbackRouter.post(
  '/:id/suggestions/:suggestionId',
  requireAuth,
  async (req: Request, res: Response) => {
    const id = readParam(req, 'id');
    const suggestionId = readParam(req, 'suggestionId');
    const status = (req.body as Record<string, unknown>).status;
    if (status !== 'accepted' && status !== 'rejected' && status !== 'pending') {
      return res
        .status(400)
        .json({ error: "status must be 'accepted', 'rejected', or 'pending'." });
    }

    // Row lock: two quick verdicts on sibling suggestions both rewrite the
    // whole JSONB array, so an unguarded read-modify-write loses one of them.
    const outcome = await getDb().transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(deckFeedback)
        .where(and(eq(deckFeedback.id, id), eq(deckFeedback.ownerUserId, req.user!.id)))
        .limit(1)
        .for('update');
      const row = rows[0];
      if (!row) return 'no-row' as const;
      const suggestions = Array.isArray(row.suggestions)
        ? (row.suggestions as FeedbackSuggestion[])
        : [];
      const target = suggestions.find((s) => s.id === suggestionId);
      if (!target) return 'no-suggestion' as const;
      target.status = status;
      await tx
        .update(deckFeedback)
        .set({ suggestions, updatedAt: Date.now() })
        .where(eq(deckFeedback.id, id));
      return 'ok' as const;
    });
    if (outcome === 'no-row') {
      return res.status(404).json({ error: 'Feedback not found.' });
    }
    if (outcome === 'no-suggestion') {
      return res.status(404).json({ error: 'Suggestion not found.' });
    }
    res.json({ suggestion: { id: suggestionId, status } });
  }
);

/** Delete a feedback response (owner only). 404 if it isn't the caller's. */
feedbackRouter.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  const id = readParam(req, 'id');
  const deleted = await getDb()
    .delete(deckFeedback)
    .where(and(eq(deckFeedback.id, id), eq(deckFeedback.ownerUserId, req.user!.id)))
    .returning({ id: deckFeedback.id });
  if (deleted.length === 0) {
    return res.status(404).json({ error: 'Feedback not found.' });
  }
  res.status(204).end();
});
