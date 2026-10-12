import type { Request, Response } from 'express';
import { getPool } from './db';
import { logger } from './logger';
import { ORIGIN } from './shares/og';

/** Hand-maintained static pages; public decks and profiles are appended live. */
export const STATIC_URLS: ReadonlyArray<{ path: string; priority: number }> = [
  { path: '/', priority: 1.0 },
  { path: '/guides/', priority: 0.6 },
  { path: '/guides/organize-your-binder.html', priority: 0.6 },
  { path: '/guides/compare.html', priority: 0.6 },
  { path: '/guides/import-manabox.html', priority: 0.5 },
  { path: '/guides/import-moxfield.html', priority: 0.5 },
  { path: '/guides/import-archidekt.html', priority: 0.5 },
  { path: '/guides/import-deckbox.html', priority: 0.5 },
  { path: '/guides/import-mtga.html', priority: 0.5 },
  { path: '/guides/import-csv.html', priority: 0.5 },
  { path: '/privacy.html', priority: 0.3 },
  { path: '/terms.html', priority: 0.3 },
];

export interface SitemapEntry {
  path: string;
  /** Epoch ms; omitted for the static pages. */
  lastmod?: number;
  priority?: number;
}

// Sitemap protocol cap is 50,000 URLs per file; leave headroom for the static rows.
const MAX_DYNAMIC = 45_000;

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Pure: entries → sitemap XML. Paths are escaped; lastmod is a YYYY-MM-DD date. */
export function buildSitemapXml(entries: SitemapEntry[]): string {
  const urls = entries.map((e) => {
    const lines = [`<loc>${xmlEscape(ORIGIN + e.path)}</loc>`];
    if (e.lastmod !== undefined) {
      lines.push(`<lastmod>${new Date(e.lastmod).toISOString().slice(0, 10)}</lastmod>`);
    }
    if (e.priority !== undefined) lines.push(`<priority>${e.priority.toFixed(1)}</priority>`);
    return `  <url>\n    ${lines.join('\n    ')}\n  </url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}

/**
 * Live public URLs: every published deck (`/d/:slug`) and every profile with at
 * least one live publication and no moderation hold (`/u/:username`) — the
 * same two indexability rules `lookupPublicDeckLandingMeta` /
 * `lookupPublicUserLandingMeta` apply per page, so the sitemap never lists a
 * URL that would answer with noindex.
 */
export async function loadDynamicEntries(): Promise<SitemapEntry[]> {
  const pool = getPool();
  const [decks, users, resources] = await Promise.all([
    pool.query<{ slug: string; updated_at: string }>(
      `SELECT slug, updated_at FROM deck_publications
        WHERE unpublished_at IS NULL ORDER BY updated_at DESC LIMIT $1`,
      [MAX_DYNAMIC]
    ),
    pool.query<{ username: string; updated_at: string }>(
      `SELECT u.username, MAX(p.updated_at) AS updated_at
         FROM users u
         JOIN (SELECT user_id, updated_at FROM deck_publications WHERE unpublished_at IS NULL
               UNION ALL
               SELECT user_id, updated_at FROM resource_publications WHERE unpublished_at IS NULL) p
           ON p.user_id = u.id
        WHERE u.profile_hidden_at IS NULL GROUP BY u.username LIMIT $1`,
      [MAX_DYNAMIC]
    ),
    pool.query<{ kind: string; slug: string; updated_at: string }>(
      `SELECT rp.kind, rp.slug, rp.updated_at
         FROM resource_publications rp JOIN users u ON u.id = rp.user_id
        WHERE rp.unpublished_at IS NULL AND u.profile_hidden_at IS NULL
        ORDER BY rp.updated_at DESC LIMIT $1`,
      [MAX_DYNAMIC]
    ),
  ]);
  return [
    ...decks.rows.map((r) => ({
      path: `/d/${r.slug}`,
      lastmod: Number(r.updated_at),
      priority: 0.7,
    })),
    ...resources.rows.map((r) => ({
      path: `${r.kind === 'binder' ? '/b/' : '/l/'}${r.slug}`,
      lastmod: Number(r.updated_at),
      priority: 0.5,
    })),
    ...users.rows.map((r) => ({
      path: `/u/${r.username}`,
      lastmod: Number(r.updated_at),
      priority: 0.4,
    })),
  ];
}

/** GET /sitemap.xml — static pages plus the live public deck/profile pages. */
export async function sitemapHandler(_req: Request, res: Response): Promise<void> {
  let dynamic: SitemapEntry[] = [];
  try {
    dynamic = await loadDynamicEntries();
  } catch (err) {
    logger.warn('[sitemap] dynamic entries failed, serving static pages only', err);
  }
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.type('application/xml').send(buildSitemapXml([...STATIC_URLS, ...dynamic]));
}
