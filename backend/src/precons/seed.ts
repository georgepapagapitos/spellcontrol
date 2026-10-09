import { getPool } from '../db';
import { logger } from '../logger';
import { resolveDeckRows, type DeckSections } from '../deck-import';
import type { ScryfallCache } from '../cache';
import { getProductDeck, listProducts, type ProductSummary } from '../products';
import { productToDeckSections } from '../product-map';
import { extractListingFields } from '../publications/listing-fields';
import { insertPublication } from '../publications/insert';
import { refreshDeckPublications } from '../publications/sync-hook';
import { invalidatePublicUserCacheById } from '../publications/purge';
import { ensureOfficialAccount } from './official-account';
import {
  buildPreconDeck,
  preconDeckId,
  preconNames,
  readPreconStamp,
  releaseDateMs,
} from './precon-deck';

/** The MTGJSON product type the starter-deck picker reads too. */
export const PRECON_PRODUCT_TYPE = 'Commander Deck';

const DAY_MS = 24 * 60 * 60 * 1000;
/** A stored deck's card data (and so its prices) is re-resolved after this long. */
const STALE_AFTER_MS = 7 * DAY_MS;
/**
 * How many stale decks one run re-resolves. At a few hundred precons and one
 * run a day this refreshes each about weekly, and it keeps a redeploy-heavy
 * day from re-downloading the whole catalog on every boot.
 */
const REFRESH_PER_RUN = 50;

/** Where precons come from. Injected so tests don't reach MTGJSON or Scryfall. */
export interface PreconSource {
  list(): Promise<ProductSummary[]>;
  /** Null when the product has no deck file (MTGJSON hasn't cataloged it yet). */
  resolve(fileName: string): Promise<DeckSections | null>;
}

export function mtgjsonPreconSource(cache: ScryfallCache): PreconSource {
  return {
    list: () => listProducts([PRECON_PRODUCT_TYPE]),
    async resolve(fileName) {
      const file = await getProductDeck(fileName);
      if (!file) return null;
      const { commanderRows, companionRows, deckRows } = productToDeckSections(file);
      return resolveDeckRows(commanderRows, companionRows, deckRows, cache);
    },
  };
}

export interface PreconSyncResult {
  published: number;
  refreshed: number;
  skipped: number;
}

/**
 * Publishes every Commander precon as a deck of the house account, and keeps
 * the stored copies current. Idempotent: a run publishes the precons it
 * hasn't seen, then re-resolves up to {@link REFRESH_PER_RUN} of the stalest
 * ones so their prices don't freeze at the day they were first stored.
 *
 * A new precon's publication is dated by its release date, not by today, so
 * the first run doesn't put a few hundred decks at the top of "newest". An
 * upcoming precon (MTGJSON lists decklists before release) is dated today,
 * never in the future, which every tile would render as "just now".
 *
 * Each deck is its own try/catch. A deck whose resolve partly failed to reach
 * Scryfall is skipped rather than stored with holes; the next run retries it.
 * A precon a moderator took down stays down: `insertPublication` never
 * touches an existing row, and the refresh only rewrites listing columns.
 */
export async function syncPrecons(
  source: PreconSource,
  { now = Date.now(), refreshLimit = REFRESH_PER_RUN } = {}
): Promise<PreconSyncResult> {
  const userId = await ensureOfficialAccount(now);
  const pool = getPool();
  const products = await source.list();

  const { rows } = await pool.query<{ data: unknown }>(
    `SELECT data FROM user_decks WHERE user_id = $1 AND deleted_at IS NULL`,
    [userId]
  );
  const refreshedAt = new Map<string, number>();
  for (const row of rows) {
    const stamp = readPreconStamp(row.data);
    if (stamp) refreshedAt.set(stamp.fileName, stamp.refreshedAt);
  }

  const missing = products.filter((p) => !refreshedAt.has(p.fileName));
  const stale = products
    .filter((p) => (refreshedAt.get(p.fileName) ?? Infinity) < now - STALE_AFTER_MS)
    .sort((a, b) => refreshedAt.get(a.fileName)! - refreshedAt.get(b.fileName)!)
    .slice(0, refreshLimit);

  const names = preconNames(products);
  const result: PreconSyncResult = { published: 0, refreshed: 0, skipped: 0 };
  for (const product of [...missing, ...stale]) {
    try {
      const named = { ...product, name: names.get(product.fileName) ?? product.name };
      const outcome = await storePrecon(userId, named, source, now);
      result[outcome]++;
    } catch (err) {
      result.skipped++;
      logger.warn(`[precons] failed to store ${product.fileName}`, err);
    }
  }

  if (result.published > 0) await invalidatePublicUserCacheById(userId);
  logger.info(
    `[precons] ${products.length} in catalogue: published ${result.published}, ` +
      `refreshed ${result.refreshed}, skipped ${result.skipped}`
  );
  return result;
}

async function storePrecon(
  userId: string,
  product: ProductSummary,
  source: PreconSource,
  now: number
): Promise<keyof PreconSyncResult> {
  const sections = await source.resolve(product.fileName);
  if (!sections || sections.fetchErrorNames.length > 0) return 'skipped';
  const data = buildPreconDeck(product, sections, now);
  const fields = data && extractListingFields(data);
  if (!data || !fields) return 'skipped';

  const deckId = preconDeckId(product.fileName);
  const { rows } = await getPool().query<{ rev: string }>(
    `INSERT INTO user_decks (user_id, id, data, rev, deleted_at, updated_at)
     VALUES ($1, $2, $3::jsonb, nextval('user_data_rev_seq'), NULL, $4)
     ON CONFLICT (user_id, id) DO UPDATE
       SET data = EXCLUDED.data, rev = EXCLUDED.rev, deleted_at = NULL, updated_at = EXCLUDED.updated_at
     RETURNING rev`,
    [userId, deckId, JSON.stringify(data), now]
  );
  const rev = Number(rows[0].rev);

  const publishedAt = Math.min(releaseDateMs(product.releaseDate) ?? now, now);
  const inserted = await insertPublication(userId, deckId, fields, rev, publishedAt);
  if (inserted) return 'published';
  // The row already exists: rewrite its listing columns from the fresh data.
  await refreshDeckPublications(userId, [{ kind: 'deck', id: deckId, rev, deletedAt: null }]);
  return 'refreshed';
}
