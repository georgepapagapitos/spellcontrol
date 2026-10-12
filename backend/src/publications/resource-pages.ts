import { and, eq, isNull } from 'drizzle-orm';
import { collectAllocatedCopyIds } from '@spellcontrol/binder-routing';
import { getDb, getPool } from '../db';
import { userBinders, userLists } from '../db/schema';
import { logger } from '../logger';
import { loadOwnerShareData } from '../shares/context';
import { ORIGIN, type ShareLandingMeta } from '../shares/og';
import {
  asRecord,
  asString,
  findListById,
  projectBinder,
  projectList,
  type PublicBinder,
  type PublicList,
} from '../shares/projections';
import { getSetMap } from '../sets';
import { buildResourceLandingBody } from '../shares/landing-body';
import { LruTtlCache } from './cache';
import { generateDeckSlug } from './slug';

/**
 * Public binder and list pages (E401): `/b/:slug` and `/l/:slug`. The publish
 * state lives in `resource_publications`; the page body is the same projection
 * a share link serves (`projectBinder` / `projectList`), read over the owner's
 * live rows, so a published binder always shows its current contents.
 */
export type ResourceKind = 'binder' | 'list';

export const RESOURCE_PATH: Record<ResourceKind, string> = { binder: '/b/', list: '/l/' };
const FALLBACK_NAME: Record<ResourceKind, string> = { binder: 'Binder', list: 'List' };

export function isResourceKind(x: unknown): x is ResourceKind {
  return x === 'binder' || x === 'list';
}

export type PublicResourcePage = {
  slug: string;
  publishedAt: number;
  updatedAt: number;
} & ({ kind: 'binder'; data: PublicBinder } | { kind: 'list'; data: PublicList });

/** One row on the owner's public profile. */
export interface PublicResourceSummary {
  kind: ResourceKind;
  slug: string;
  name: string;
  publishedAt: number;
  updatedAt: number;
}

export const resourcePageCache = new LruTtlCache<PublicResourcePage>();

export function invalidateResourcePageCache(slug: string): void {
  resourcePageCache.invalidate(slug);
}

/** The owner's current name for the entity, or null when it is missing or deleted. */
export async function readResourceName(
  userId: string,
  kind: ResourceKind,
  resourceId: string
): Promise<string | null> {
  const db = getDb();
  const table = kind === 'binder' ? userBinders : userLists;
  const rows = await db
    .select({ data: table.data })
    .from(table)
    .where(and(eq(table.userId, userId), eq(table.id, resourceId), isNull(table.deletedAt)))
    .limit(1);
  if (rows.length === 0) return null;
  return asString(asRecord(rows[0].data)?.name)?.trim() || FALLBACK_NAME[kind];
}

export function newResourceSlug(kind: ResourceKind, name: string): string {
  return generateDeckSlug(name, kind);
}

interface PublicationJoinRow {
  user_id: string;
  resource_id: string;
  published_at: string;
  updated_at: string;
  username: string;
  display_name: string | null;
  profile_hidden_at: string | null;
}

/** A live, unmoderated publication's page, or null (unknown, unpublished,
 *  deleted resource and hidden owner all read the same). */
export async function loadPublicResourcePage(
  kind: ResourceKind,
  slug: string
): Promise<PublicResourcePage | null> {
  const cached = resourcePageCache.get(slug);
  if (cached) return cached.kind === kind ? cached : null;

  const pub = (
    await getPool().query<PublicationJoinRow>(
      `SELECT rp.user_id, rp.resource_id, rp.published_at, rp.updated_at,
              u.username, u.display_name, u.profile_hidden_at
         FROM resource_publications rp
         JOIN users u ON u.id = rp.user_id
        WHERE rp.slug = $1 AND rp.kind = $2 AND rp.unpublished_at IS NULL
        LIMIT 1`,
      [slug, kind]
    )
  ).rows[0];
  if (!pub || pub.profile_hidden_at !== null) return null;

  const owner = { username: pub.username, displayName: pub.display_name };
  const data = await loadOwnerShareData(pub.user_id, kind);
  const base = { slug, publishedAt: Number(pub.published_at), updatedAt: Number(pub.updated_at) };
  let page: PublicResourcePage | null = null;
  if (kind === 'binder') {
    // A Scryfall hiccup degrades to undated order, never a 500 (same as the share route).
    const setMap = await getSetMap().catch(() => undefined);
    const projected = projectBinder(
      owner,
      pub.resource_id,
      data.collection,
      data.binders,
      setMap,
      collectAllocatedCopyIds(data.decks, data.cubes)
    );
    if (projected) page = { ...base, kind, data: projected };
  } else {
    const projected = projectList(owner, findListById(data.collection, pub.resource_id));
    if (projected) page = { ...base, kind, data: projected };
  }
  if (page) resourcePageCache.set(slug, page);
  return page;
}

function countFor(page: PublicResourcePage): number {
  return page.kind === 'binder'
    ? page.data.totalCards
    : page.data.entries.reduce((n, e) => n + e.quantity, 0);
}

/** OG/robots metadata for the `/b/:slug` and `/l/:slug` server-rendered landings. */
export function resourceLandingLookup(kind: ResourceKind) {
  return async (slug: string): Promise<ShareLandingMeta | null> => {
    const page = await loadPublicResourcePage(kind, slug).catch((err: unknown) => {
      logger.warn('[public] resource landing failed', err);
      return null;
    });
    if (!page) return null; // same stealth as the JSON 404
    const n = countFor(page);
    const owner = page.data.ownerDisplayName ?? page.data.ownerUsername;
    const noun = kind === 'binder' ? 'binder' : 'card list';
    return {
      body: buildResourceLandingBody(page),
      title: `${page.data.name}, a Magic: The Gathering ${noun}`,
      description: `${n} card${n === 1 ? '' : 's'} in ${owner}'s ${noun} on SpellControl.`,
      url: `${ORIGIN}${RESOURCE_PATH[kind]}${slug}`,
      indexable: true,
    };
  };
}

/** The owner's live published binders and lists, newest first (profile page + landing body). */
export async function listPublishedResources(userId: string): Promise<PublicResourceSummary[]> {
  const { rows } = await getPool().query<{
    kind: ResourceKind;
    slug: string;
    name: string;
    published_at: string;
    updated_at: string;
  }>(
    `SELECT kind, slug, name, published_at, updated_at
       FROM resource_publications
      WHERE user_id = $1 AND unpublished_at IS NULL
      ORDER BY updated_at DESC LIMIT 200`,
    [userId]
  );
  return rows.map((r) => ({
    kind: r.kind,
    slug: r.slug,
    name: r.name,
    publishedAt: Number(r.published_at),
    updatedAt: Number(r.updated_at),
  }));
}
