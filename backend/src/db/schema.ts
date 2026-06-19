import {
  pgTable,
  text,
  integer,
  jsonb,
  bigint,
  boolean,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  // Nullable: SSO-only accounts (Google) have no password. A null hash means
  // the account can only be reached through an external provider — the login
  // route treats a null hash as "no password set" and rejects the attempt.
  passwordHash: text('password_hash'),
  // Set for OAuth-created accounts (Google supplies it); null for username-only
  // password accounts. Unique so a future "link by email" feature is purely
  // additive — multiple NULLs are allowed (NULLs are distinct in the index).
  email: text('email'),
  emailVerified: boolean('email_verified').notNull().default(false),
  // 'user' (default) or 'admin'. Admin grants access to /api/admin/*; promoted
  // at boot for any username in ADMIN_USERNAMES, additively (never demotes).
  role: text('role').notNull().default('user'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  // Set when the OAuth callback auto-linked a new external identity to this
  // account via a verified-email match (e.g. user with a password account
  // signs in with the same email via Google). The /me endpoint exposes it so
  // the frontend can surface a "we linked X — was this you? unlink" banner
  // until the user acknowledges it via POST /me/acknowledge-auto-link.
  autoLinkedAt: bigint('auto_linked_at', { mode: 'number' }),
});

/**
 * External login providers linked to a user (Google today; the shape is
 * provider-agnostic so GitHub/Apple slot in later). Password login is NOT a
 * row here — it stays as the `users.password_hash` column. One user may have
 * several identities; `(provider, providerSubject)` is globally unique so an
 * external account maps to exactly one SpellControl user.
 */
export const authIdentities = pgTable(
  'auth_identities',
  {
    /** 'google' — the OAuth provider key. */
    provider: text('provider').notNull(),
    /** The provider's stable user id (Google's `sub` claim). */
    providerSubject: text('provider_subject').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.provider, t.providerSubject] }),
    userIdx: index('auth_identities_user_idx').on(t.userId),
  })
);

/**
 * Single-use codes that bridge the native OAuth flow. The Google callback
 * runs in the system browser, whose cookie jar the Capacitor WebView cannot
 * read; instead the callback mints a code here and deep-links it back into the
 * app, which exchanges it for a real session cookie. Rows are deleted on
 * exchange and are short-lived (~60s) — see `routes/auth.ts`.
 */
export const oauthHandoffCodes = pgTable('oauth_handoff_codes', {
  code: text('code').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
});

/**
 * Per-entity sync tables. Each user-data row is its own database row with a
 * monotonic `rev` and a soft-delete `deleted_at`; clients pull deltas since a
 * cursor and apply tombstones, so a deletion on one device propagates to every
 * other device on its next pull. Replaces the prior single-blob `user_data`
 * model whose whole-snapshot PUT semantics could resurrect deleted rows from a
 * stale device. `rev` is drawn from a shared sequence (`user_data_rev_seq`); a
 * tombstone row carries `deleted_at != NULL` and `data = NULL`.
 */
const entityColumns = {
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  id: text('id').notNull(),
  data: jsonb('data'),
  rev: bigint('rev', { mode: 'number' }).notNull(),
  deletedAt: bigint('deleted_at', { mode: 'number' }),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
} as const;

export const userImports = pgTable('user_imports', { ...entityColumns }, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.id] }),
  revIdx: index('user_imports_rev_idx').on(t.userId, t.rev),
}));

export const userCards = pgTable(
  'user_cards',
  {
    ...entityColumns,
    /** Owning import. Not enforced as a SQL FK — the app cascades via tombstones. */
    importId: text('import_id').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.id] }),
    revIdx: index('user_cards_rev_idx').on(t.userId, t.rev),
    importIdx: index('user_cards_import_idx').on(t.userId, t.importId),
  })
);

export const userBinders = pgTable('user_binders', { ...entityColumns }, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.id] }),
  revIdx: index('user_binders_rev_idx').on(t.userId, t.rev),
}));

export const userDecks = pgTable('user_decks', { ...entityColumns }, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.id] }),
  revIdx: index('user_decks_rev_idx').on(t.userId, t.rev),
}));

export const userGames = pgTable('user_games', { ...entityColumns }, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.id] }),
  revIdx: index('user_games_rev_idx').on(t.userId, t.rev),
}));

export const userLists = pgTable('user_lists', { ...entityColumns }, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.id] }),
  revIdx: index('user_lists_rev_idx').on(t.userId, t.rev),
}));

export const userCubes = pgTable('user_cubes', { ...entityColumns }, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.id] }),
  revIdx: index('user_cubes_rev_idx').on(t.userId, t.rev),
}));

/**
 * Live multi-device game sessions. The full game state (players, life totals,
 * commander damage, event log) lives in `state` JSONB; clients poll GET and
 * mutate via PATCH with optimistic concurrency on `version`. Finished sessions
 * are kept briefly so each participant's client can pull the final snapshot
 * into its own history, then expired by a periodic sweep.
 */
export const gameSessions = pgTable('game_sessions', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  hostUserId: text('host_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  status: text('status').notNull(),
  state: jsonb('state').notNull(),
  version: integer('version').notNull().default(0),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

/**
 * Global Commander Spellbook combo dataset. One row per combo variant; the
 * full card set lives in `comboCards`. Refreshed nightly from the Spellbook
 * bulk export — see `combos/ingest.ts`. Reference data, not user data.
 */
export const combos = pgTable('combos', {
  id: text('id').primaryKey(),
  identity: text('identity').notNull(),
  produces: jsonb('produces').notNull().$type<string[]>(),
  /**
   * Structured prerequisites mirroring Spellbook's split:
   *   { easy?: string, notable?: string }
   * Stored as JSONB so we can render distinct sections in the UI without a
   * second lookup. Both fields are optional — most combos have one or the
   * other, some have both, some have neither.
   */
  prerequisites: jsonb('prerequisites').$type<{ easy?: string; notable?: string }>(),
  description: text('description'),
  manaNeeded: text('mana_needed'),
  popularity: integer('popularity').notNull().default(0),
  legalities: jsonb('legalities').notNull().$type<Record<string, string>>(),
  cardCount: integer('card_count').notNull(),
  bracket: integer('bracket'),
  bracketTag: text('bracket_tag'),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

export const comboCards = pgTable(
  'combo_cards',
  {
    comboId: text('combo_id')
      .notNull()
      .references(() => combos.id, { onDelete: 'cascade' }),
    oracleId: text('oracle_id').notNull(),
    cardName: text('card_name').notNull(),
    /** Number of copies of this card the combo needs (Spellbook `uses[].quantity`). */
    quantity: integer('quantity').notNull().default(1),
    position: integer('position').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.comboId, t.oracleId] }),
    oracleIdx: index('combo_cards_oracle_idx').on(t.oracleId),
  })
);

export const comboIngestRuns = pgTable('combo_ingest_runs', {
  id: text('id').primaryKey(),
  startedAt: bigint('started_at', { mode: 'number' }).notNull(),
  finishedAt: bigint('finished_at', { mode: 'number' }),
  combosWritten: integer('combos_written'),
  source: text('source').notNull(),
  error: text('error'),
});

/**
 * Public share links. Each row maps an unguessable token to a slice of a user's
 * data: the whole collection, a single binder, a single deck, or a single list.
 * The public read route looks up the row, loads the relevant rows from the
 * per-entity tables (`user_cards`, `user_binders`, `user_decks`), projects the
 * requested slice through the public-projection layer, and returns it. Revoking
 * sets revokedAt; revoked tokens 404.
 *
 * `resourceId` is the id of the binder/deck/list row. For kind='collection' it
 * is unused (stored as empty string) — there's only one collection per user.
 */
export const shares = pgTable(
  'shares',
  {
    token: text('token').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().$type<'collection' | 'binder' | 'deck' | 'list'>(),
    resourceId: text('resource_id').notNull().default(''),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    revokedAt: bigint('revoked_at', { mode: 'number' }),
  },
  (t) => ({
    userIdx: index('shares_user_idx').on(t.userId),
    resourceIdx: index('shares_resource_idx').on(t.userId, t.kind, t.resourceId),
  })
);

/**
 * Friend relationships between users. Stored directionally: the sender is
 * `requester_id`, the recipient is `addressee_id`. Status is 'pending' until
 * the addressee accepts, then 'accepted'. Uniqueness across both orderings is
 * enforced in application code (block (B,A) when (A,B) exists).
 */
export const friendships = pgTable(
  'friendships',
  {
    requesterId: text('requester_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    addresseeId: text('addressee_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 'pending' | 'accepted' */
    status: text('status').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    acceptedAt: bigint('accepted_at', { mode: 'number' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.requesterId, t.addresseeId] }),
    addresseeIdx: index('friendships_addressee_idx').on(t.addresseeId),
    statusIdx: index('friendships_status_idx').on(t.status),
  })
);

export type UserRow = typeof users.$inferSelect;
export type AuthIdentityRow = typeof authIdentities.$inferSelect;
export type OauthHandoffCodeRow = typeof oauthHandoffCodes.$inferSelect;
export type UserImportRow = typeof userImports.$inferSelect;
export type UserCardRow = typeof userCards.$inferSelect;
export type UserBinderRow = typeof userBinders.$inferSelect;
export type UserDeckRow = typeof userDecks.$inferSelect;
export type UserGameRow = typeof userGames.$inferSelect;
export type UserListRow = typeof userLists.$inferSelect;
export type UserCubeRow = typeof userCubes.$inferSelect;
export type GameSessionRow = typeof gameSessions.$inferSelect;
export type ComboRow = typeof combos.$inferSelect;
export type ComboCardRow = typeof comboCards.$inferSelect;
export type ComboIngestRunRow = typeof comboIngestRuns.$inferSelect;
export type ShareRow = typeof shares.$inferSelect;
export type FriendshipRow = typeof friendships.$inferSelect;
