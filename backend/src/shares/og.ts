import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { logger } from '../logger';
import { loadShareContext } from './context';
import {
  asRecord,
  asString,
  findBinderById,
  findCubeById,
  findDeckById,
  findListById,
} from './projections';

export const ORIGIN = 'https://spellcontrol.com';
export const SITE_NAME = 'SpellControl';
const FALLBACK_DESCRIPTION = 'A read-only view of a SpellControl Magic: The Gathering collection.';
const OG_IMAGE_URL = `${ORIGIN}/og-image.png`;

export interface ShareLandingMeta {
  title: string;
  description: string;
  url: string;
  /** Card-art `og:image` override (art_crop URL). Absent falls back to OG_IMAGE_URL. */
  image?: string;
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
    const image = escapeHtmlAttr(meta.image ?? OG_IMAGE_URL);
    lines.push(
      `<meta property="og:type" content="website" />`,
      `<meta property="og:site_name" content="${SITE_NAME}" />`,
      `<meta property="og:title" content="${title}" />`,
      `<meta property="og:description" content="${description}" />`,
      `<meta property="og:url" content="${url}" />`,
      `<meta property="og:image" content="${image}" />`,
      `<meta property="og:image:alt" content="${title}" />`,
      `<meta name="twitter:card" content="summary" />`,
      `<meta name="twitter:title" content="${title}" />`,
      `<meta name="twitter:description" content="${description}" />`,
      `<meta name="twitter:image" content="${image}" />`
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

function countCollectionCards(collection: unknown): number {
  const r = asRecord(collection);
  if (!r) return 0;
  return Array.isArray(r.cards) ? r.cards.length : 0;
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/**
 * Derive a card's art_crop URL from its raw (unknown-shaped) Scryfall data,
 * reading the real field the way every other call site in this codebase does
 * (`image_uris?.art_crop ?? card_faces?.[0]?.image_uris?.art_crop`) rather
 * than deriving one from `/normal/` — that string-replace trick
 * (`scryfallArtCrop` in the frontend) exists only for the offline slim
 * bundle's degraded payload and would fabricate a 404 for any card that
 * genuinely has no art_crop variant. Returns undefined (never throws) when
 * neither shape yields an image, so callers can chain `??` freely.
 */
export function cardArtUrl(raw: unknown): string | undefined {
  const card = asRecord(raw);
  if (!card) return undefined;
  const direct = asString(asRecord(card.image_uris)?.art_crop);
  if (direct) return direct;
  const face = Array.isArray(card.card_faces) ? asRecord(card.card_faces[0]) : null;
  return asString(asRecord(face?.image_uris)?.art_crop);
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
  const { share, ownerUsername, ownerDisplayName, data } = ctx;
  // Link-preview text only (still noindex per the /s/ secret-link constraint) —
  // prefer the owner's display name, same propagation as everywhere else.
  const owner = ownerDisplayName ?? ownerUsername;
  const url = `${ORIGIN}/s/${token}`;

  if (share.kind === 'collection') {
    const count = countCollectionCards(data.collection);
    return {
      title: `${owner}'s collection — ${SITE_NAME}`,
      description: `${plural(count, 'card', 'cards')} shared by ${owner}. ${FALLBACK_DESCRIPTION}`,
      url,
    };
  }
  if (share.kind === 'deck' || share.kind === 'feedback') {
    const deck = asRecord(findDeckById(data.decks, share.resourceId));
    if (!deck) return null;
    const name = asString(deck.name) ?? 'Untitled deck';
    const format = asString(deck.format) ?? 'Magic';
    const cardsArr = Array.isArray(deck.cards) ? deck.cards : [];
    const cards = cardsArr.length;
    // Commander → partner commander → first mainboard card. DeckCard wraps
    // `card: ScryfallCard`, so the first mainboard card is `cardsArr[0]?.card`.
    const image =
      cardArtUrl(deck.commander) ??
      cardArtUrl(deck.partnerCommander) ??
      cardArtUrl(asRecord(cardsArr[0])?.card);
    if (share.kind === 'feedback') {
      return {
        title: `${name} — feedback wanted`,
        description: `${owner} is asking for advice on this ${format} deck (${plural(cards, 'card', 'cards')}). Suggest adds and cuts on ${SITE_NAME}.`,
        url,
        image,
      };
    }
    return {
      title: `${name} — shared by ${owner}`,
      description: `A ${format} deck (${plural(cards, 'card', 'cards')}) shared by ${owner} on ${SITE_NAME}.`,
      url,
      image,
    };
  }
  if (share.kind === 'list') {
    const list = asRecord(findListById(data.collection, share.resourceId));
    if (!list) return null;
    const name = asString(list.name) ?? 'Untitled list';
    const entries = Array.isArray(list.entries) ? list.entries.length : 0;
    return {
      title: `${name} — shared by ${owner}`,
      description: `A list (${plural(entries, 'entry', 'entries')}) shared by ${owner} on ${SITE_NAME}.`,
      url,
    };
  }
  if (share.kind === 'binder') {
    const binder = asRecord(findBinderById(data.binders, share.resourceId));
    if (!binder) return null;
    const name = asString(binder.name) ?? 'Untitled binder';
    return {
      title: `${name} — shared by ${owner}`,
      description: `A binder shared by ${owner} on ${SITE_NAME}.`,
      url,
    };
  }
  if (share.kind === 'cube') {
    const cube = asRecord(findCubeById(data.cubes, share.resourceId));
    if (!cube) return null;
    const name = asString(cube.name) ?? 'Untitled cube';
    const size = typeof cube.size === 'number' && Number.isFinite(cube.size) ? cube.size : 0;
    const sizeText = size > 0 ? `${size}-card cube` : 'cube';
    return {
      title: `${name} — shared by ${owner}`,
      description: `A ${sizeText} shared by ${owner} on ${SITE_NAME}.`,
      url,
    };
  }
  return null;
}

/**
 * Express handler for `GET /s/:token` (and, via a custom `lookup`, any other
 * token-landing route like `/gn/:token`). Reads `<spaDir>/index.html` once at
 * factory-call time (kept in a closure so we don't re-read per request), then
 * for each hit looks up the token's meta, injects OG + noindex into <head>,
 * and sends it back. DB / template errors fall back to the bare SPA shell with
 * just the noindex meta — the React app then renders its own 404 / loading
 * state from the same public endpoint it always uses.
 */
export function createShareLandingHandler(
  spaDir: string,
  lookup: (token: string) => Promise<ShareLandingMeta | null> = lookupShareLandingMeta
): RequestHandler {
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
      meta = await lookup(token);
    } catch (err) {
      logger.warn('[shares/og] lookup failed, serving bare shell with noindex:', err);
    }
    const html = injectShareHead(shell, meta);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.type('html').send(html);
  };
}
