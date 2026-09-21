import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { logger } from '../logger';
import { loadShareContext } from './context';
import {
  asRecord,
  asString,
  clampDeckName,
  countProjectable,
  findBinderById,
  findCubeById,
  findDeckById,
  findListById,
  isProjectableCard,
  isProjectableSlot,
} from './projections';

export const ORIGIN = 'https://spellcontrol.com';
export const SITE_NAME = 'SpellControl';
const FALLBACK_DESCRIPTION = 'A read-only view of a SpellControl Magic: The Gathering collection.';
const OG_IMAGE_URL = `${ORIGIN}/og-image.png`;

/**
 * A landing lookup that resolved to a DIFFERENT canonical URL: the handle in
 * the path was released by a rename and nobody has claimed it since. The
 * handler answers with a real 301 rather than rendering the shell, so a
 * crawler moves its index entry and a person's address bar lands on the
 * handle that account actually has now.
 */
export interface ShareLandingRedirect {
  redirectTo: string;
}

export type ShareLandingResult = ShareLandingMeta | ShareLandingRedirect;

export interface ShareLandingMeta {
  title: string;
  description: string;
  url: string;
  /** Card-art `og:image` override (art_crop URL). Absent falls back to OG_IMAGE_URL. */
  image?: string;
  /**
   * When true, the landing page is crawlable: the noindex meta is omitted
   * and a `<link rel="canonical">` is emitted instead. Absent/false keeps
   * today's noindex-always behavior — every existing lookup (share tokens,
   * game nights) leaves this unset on purpose; only public deck/profile
   * pages (w1-public-routes-linkability) opt in.
   */
  indexable?: boolean;
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
 * The block injected into the SPA shell's <head>. Emits a
 * `robots: noindex,nofollow` meta unless `meta.indexable` is true — so a
 * crawler that hits a stale or revoked share URL never indexes the
 * generic "loading…" shell, while an indexable public deck/profile page
 * gets a `<link rel="canonical">` instead. OG/Twitter tags are added only
 * when we have a real share to describe.
 */
export function buildShareHeadTags(meta: ShareLandingMeta | null): string {
  const lines: string[] = [];
  if (!meta?.indexable) {
    lines.push('<meta name="robots" content="noindex,nofollow" />');
  }
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
    if (meta.indexable) {
      lines.push(`<link rel="canonical" href="${url}" />`);
    }
  }
  return lines.join('\n    ');
}

/**
 * The shell's own homepage head tags, which must come OUT whenever we splice a
 * real share's tags in. `frontend/index.html` carries a static homepage card —
 * a canonical pointing at the site root plus a full og:/twitter: set — because
 * a client-rendered SPA cannot vary those per route. Appending ours after them
 * left BOTH on the page, and a duplicated `og:title` / `rel=canonical` is not
 * "the later one wins": it is undefined, and consumers genuinely differ.
 *
 * Two measured consequences, which is why this is a strip and not a tidy-up:
 *
 *  - Search. Google discards conflicting canonicals, so every public deck and
 *    profile page was telling it "I am the homepage" and never ranked as
 *    itself. Search Console, three months: ~1,200 impressions and 5 clicks,
 *    every click on a static guide page, none on a deck — while the top
 *    queries ("mono black devotion", "atraxa", "xenagos") were real archetype
 *    demand that Google had already matched to those deck pages.
 *  - Sharing. Every share link — collection, deck, game-night invite — carried
 *    the homepage card first, so previews were at best non-deterministic and
 *    at worst generic. That is the app's main organic loop previewing as a
 *    stranger.
 */
const SHELL_HOMEPAGE_TAGS =
  /[ \t]*<(?:link\s[^>]*rel="canonical"|meta\s[^>]*(?:property="og:|name="twitter:))[^>]*>\s*\n?/gi;

/**
 * Splice the OG/robots block in just before `</head>`. Returns the
 * original HTML unchanged if `</head>` isn't found — defensive against a
 * malformed template; we'd rather serve the SPA without OG than 500.
 *
 * When we have a real share to describe, the shell's homepage tags are
 * stripped first (see SHELL_HOMEPAGE_TAGS) and the document `<title>` is
 * rewritten — a search result's headline comes from `<title>`, never from
 * `og:title`, so leaving the shell's meant every page in the index presented
 * as the same generic string. `buildShareHeadTags` emits a superset of what is
 * removed, so nothing is lost.
 *
 * With no meta (an unknown or revoked share) the shell is left exactly as it
 * was and only the noindex is added: there is nothing better to describe the
 * page with, and the homepage card is a reasonable fallback.
 */
export function injectShareHead(html: string, meta: ShareLandingMeta | null): string {
  const idx = html.lastIndexOf('</head>');
  if (idx === -1) return html;
  let head = html.slice(0, idx);
  if (meta) {
    head = head.replace(SHELL_HOMEPAGE_TAGS, '');
    head = head.replace(
      /<title>[\s\S]*?<\/title>/i,
      `<title>${escapeHtmlAttr(meta.title)}</title>`
    );
  }
  const block = buildShareHeadTags(meta);
  return `${head}    ${block}\n  ${html.slice(idx)}`;
}

/**
 * Every count in a link preview is counted with the SAME predicate the public
 * page renders with (`isProjectableCard` / `isProjectableSlot`), never with
 * `raw.length`. A row the page cannot render is a row the preview must not
 * promise: one unrenderable card in the dev collection had the unfurl saying
 * 11,533 over a page saying 11,532 (board E343), and the deck and list
 * previews counted raw rows the same way.
 */
function countCollectionCards(collection: unknown): number {
  const r = asRecord(collection);
  return r ? countProjectable(r.cards, isProjectableCard) : 0;
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
    // Clamped for the same reason the publication listing clamps: this string
    // is the preview's title (board E342).
    const name = clampDeckName(asString(deck.name) ?? 'Untitled deck');
    const format = asString(deck.format) ?? 'Magic';
    const cardsArr = Array.isArray(deck.cards) ? deck.cards : [];
    const cards = countProjectable(cardsArr, isProjectableSlot);
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
    const entries = countProjectable(list.entries, isProjectableCard);
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
  if (share.kind === 'game-result') {
    // No image field yet (ShareLandingMeta has none on any kind today) — this
    // ships text-only OG, same as every other kind.
    const gr = asRecord(data.gameResult);
    if (!gr) return null;
    const format = asString(gr.format) ?? 'Magic';
    const winnerSeat =
      typeof gr.winnerSeat === 'number' && Number.isFinite(gr.winnerSeat) ? gr.winnerSeat : null;
    const participants = Array.isArray(gr.participants) ? gr.participants : [];
    const winner =
      winnerSeat !== null
        ? asRecord(participants.find((p) => asRecord(p)?.seat === winnerSeat))
        : null;
    const winnerName = winner ? asString(winner.name) : undefined;
    const notableEvents = Array.isArray(gr.notableEvents) ? gr.notableEvents : [];
    const title = winnerName ? `${winnerName} wins — ${format} recap` : `${format} game recap`;
    const description = `A ${format} game with ${plural(participants.length, 'player', 'players')}${
      notableEvents.length > 0
        ? `, ${plural(notableEvents.length, 'notable moment', 'notable moments')}`
        : ''
    }. Shared by ${owner} on ${SITE_NAME}.`;
    return { title, description, url };
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
  lookup: (token: string) => Promise<ShareLandingResult | null> = lookupShareLandingMeta
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
    let meta: ShareLandingResult | null = null;
    let lookupFailed = false;
    try {
      meta = await lookup(token);
    } catch (err) {
      lookupFailed = true;
      logger.warn('[shares/og] lookup failed, serving bare shell with noindex:', err);
    }
    if (meta && 'redirectTo' in meta) {
      res.redirect(301, meta.redirectTo);
      return;
    }
    // A definite miss (unknown/revoked token, unpublished slug, hidden or
    // publication-less profile) is a real 404, not a soft one: crawlers drop
    // it instead of indexing a "loading" shell. The SPA still boots from the
    // same HTML and renders its own not-found state. A lookup *error* keeps
    // 200 so a DB blip never tells Google a live page is gone.
    if (!meta && !lookupFailed) res.status(404);
    const html = injectShareHead(shell, meta);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.type('html').send(html);
  };
}
