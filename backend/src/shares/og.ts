import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { logger } from '../logger';
import { loadShareContext } from './context';
import { findBinderById, findDeckById, findListById } from './projections';

const ORIGIN = 'https://spellcontrol.com';
const SITE_NAME = 'SpellControl';
const FALLBACK_DESCRIPTION = 'A read-only view of a SpellControl Magic: The Gathering collection.';

export interface ShareLandingMeta {
  title: string;
  description: string;
  url: string;
}

export function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The block injected into the SPA shell's <head>. Always emits a
 * `robots: noindex,nofollow` meta — even for unknown tokens — so a
 * crawler that hits a stale or revoked share URL never indexes the
 * generic "loading…" shell. OG/Twitter tags are added only when we
 * have a real share to describe.
 */
export function buildShareHeadTags(meta: ShareLandingMeta | null): string {
  const lines = ['<meta name="robots" content="noindex,nofollow" />'];
  if (meta) {
    const title = escapeHtmlAttr(meta.title);
    const description = escapeHtmlAttr(meta.description);
    const url = escapeHtmlAttr(meta.url);
    lines.push(
      `<meta property="og:type" content="website" />`,
      `<meta property="og:site_name" content="${SITE_NAME}" />`,
      `<meta property="og:title" content="${title}" />`,
      `<meta property="og:description" content="${description}" />`,
      `<meta property="og:url" content="${url}" />`,
      `<meta name="twitter:card" content="summary" />`,
      `<meta name="twitter:title" content="${title}" />`,
      `<meta name="twitter:description" content="${description}" />`
    );
  }
  return lines.join('\n    ');
}

/**
 * Splice the OG/robots block in just before `</head>`. Returns the
 * original HTML unchanged if `</head>` isn't found — defensive against a
 * malformed template; we'd rather serve the SPA without OG than 500.
 */
export function injectShareHead(html: string, meta: ShareLandingMeta | null): string {
  const idx = html.lastIndexOf('</head>');
  if (idx === -1) return html;
  const block = buildShareHeadTags(meta);
  return `${html.slice(0, idx)}    ${block}\n  ${html.slice(idx)}`;
}

function asRecord(x: unknown): Record<string, unknown> | null {
  return x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

function asString(x: unknown): string | undefined {
  return typeof x === 'string' && x.length > 0 ? x : undefined;
}

function countCollectionCards(collection: unknown): number {
  const r = asRecord(collection);
  if (!r) return 0;
  return Array.isArray(r.cards) ? r.cards.length : 0;
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/**
 * Cheap metadata lookup for a share token — just enough to render OG/Twitter
 * preview tags. Returns null for unknown / revoked tokens and for shares
 * whose underlying resource has been deleted (matches `GET /public/:token`'s
 * 404 semantics).
 *
 * Deliberately not factored together with the public JSON route's lookup:
 * that one runs the full `project*` materialization (which can be heavy for
 * binders); this one only needs the resource's display name and a count,
 * so it stays a small constant-time read per share kind.
 */
export async function lookupShareLandingMeta(token: string): Promise<ShareLandingMeta | null> {
  const ctx = await loadShareContext(token);
  if (!ctx) return null;
  const { share, ownerUsername, data } = ctx;
  const url = `${ORIGIN}/s/${token}`;

  if (share.kind === 'collection') {
    const count = countCollectionCards(data.collection);
    return {
      title: `${ownerUsername}'s collection — ${SITE_NAME}`,
      description: `${plural(count, 'card', 'cards')} shared by ${ownerUsername}. ${FALLBACK_DESCRIPTION}`,
      url,
    };
  }
  if (share.kind === 'deck') {
    const deck = asRecord(findDeckById(data.decks, share.resourceId));
    if (!deck) return null;
    const name = asString(deck.name) ?? 'Untitled deck';
    const format = asString(deck.format) ?? 'Magic';
    const cards = Array.isArray(deck.cards) ? deck.cards.length : 0;
    return {
      title: `${name} — shared by ${ownerUsername}`,
      description: `A ${format} deck (${plural(cards, 'card', 'cards')}) shared by ${ownerUsername} on ${SITE_NAME}.`,
      url,
    };
  }
  if (share.kind === 'list') {
    const list = asRecord(findListById(data.collection, share.resourceId));
    if (!list) return null;
    const name = asString(list.name) ?? 'Untitled list';
    const entries = Array.isArray(list.entries) ? list.entries.length : 0;
    return {
      title: `${name} — shared by ${ownerUsername}`,
      description: `A list (${plural(entries, 'entry', 'entries')}) shared by ${ownerUsername} on ${SITE_NAME}.`,
      url,
    };
  }
  if (share.kind === 'binder') {
    const binder = asRecord(findBinderById(data.binders, share.resourceId));
    if (!binder) return null;
    const name = asString(binder.name) ?? 'Untitled binder';
    return {
      title: `${name} — shared by ${ownerUsername}`,
      description: `A binder shared by ${ownerUsername} on ${SITE_NAME}.`,
      url,
    };
  }
  return null;
}

/**
 * Express handler for `GET /s/:token`. Reads `<spaDir>/index.html` once at
 * factory-call time (kept in a closure so we don't re-read per request), then
 * for each hit looks up the share, injects OG + noindex into <head>, and
 * sends it back. DB / template errors fall back to the bare SPA shell with
 * just the noindex meta — the React app then renders its own 404 / loading
 * state from the same `/api/shares/public/:token` endpoint it always uses.
 */
export function createShareLandingHandler(spaDir: string): RequestHandler {
  const indexPath = path.join(spaDir, 'index.html');
  let cachedShell: string | null = null;
  const loadShell = (): string => {
    if (cachedShell !== null) return cachedShell;
    cachedShell = fs.readFileSync(indexPath, 'utf8');
    return cachedShell;
  };

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = typeof req.params.token === 'string' ? req.params.token : '';
    if (!token) return next();
    let shell: string;
    try {
      shell = loadShell();
    } catch (err) {
      logger.error('[shares/og] could not read index.html template', err);
      return next();
    }
    let meta: ShareLandingMeta | null = null;
    try {
      meta = await lookupShareLandingMeta(token);
    } catch (err) {
      logger.warn('[shares/og] lookup failed, serving bare shell with noindex:', err);
    }
    const html = injectShareHead(shell, meta);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.type('html').send(html);
  };
}
