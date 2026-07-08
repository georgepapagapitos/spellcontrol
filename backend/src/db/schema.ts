import { sql } from 'drizzle-orm';
import {
  pgTable,
  text,
  integer,
  jsonb,
  bigint,
  boolean,
  primaryKey,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { GameResultParticipant } from '../games/result-types';

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
    kind: text('kind')
      .notNull()
      .$type<'collection' | 'binder' | 'deck' | 'list' | 'cube' | 'feedback'>(),
    resourceId: text('resource_id').notNull().default(''),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    revokedAt: bigint('revoked_at', { mode: 'number' }),
    /**
     * Who can open the link. 'link' (default, legacy rows) = anyone with the
     * URL; 'friends' = accepted friends of the owner, signed in. 'direct' (a
     * share addressed to one friend) lands in a follow-up — the column is typed
     * for it now so the audience contract is stable. NULL never stored.
     */
    audience: text('audience').notNull().default('link').$type<'link' | 'friends' | 'direct'>(),
    /**
     * Recipient for audience='direct' (a share addressed to one friend); NULL
     * otherwise. ON DELETE SET NULL so deleting the recipient doesn't destroy
     * the sender's row — it goes inert (the read gate treats a NULL-addressee
     * direct share as inaccessible, never as a public fallback).
     */
    addresseeId: text('addressee_id').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    userIdx: index('shares_user_idx').on(t.userId),
    resourceIdx: index('shares_resource_idx').on(t.userId, t.kind, t.resourceId),
    audienceIdx: index('shares_audience_idx').on(t.userId, t.audience),
    addresseeIdx: index('shares_addressee_idx').on(t.addresseeId),
  })
);

/**
 * Scheduled game nights (E123). A night is a *scheduling* artifact — date,
 * place, who's coming — separate from `game_sessions` (the live authed game).
 * The unguessable `token` powers the public no-account RSVP page (`/gn/:token`),
 * mirroring the shares token contract: unknown and revoked (cancelled nights
 * stay readable so the page can say "cancelled") — only unknown tokens 404.
 */
export const gameNights = pgTable(
  'game_nights',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull().unique(),
    hostUserId: text('host_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** Epoch ms. Clients render in their own timezone. */
    startsAt: bigint('starts_at', { mode: 'number' }).notNull(),
    /** Host's IANA timezone at creation — lets the OG unfurl show the host-local time. */
    timezone: text('timezone'),
    location: text('location'),
    notes: text('notes'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    cancelledAt: bigint('cancelled_at', { mode: 'number' }),
    /** Recurring series this night is an occurrence of (E125); NULL = one-off. */
    seriesId: text('series_id').references(() => gameNightSeries.id, { onDelete: 'set null' }),
    /** Invite-only: the link shows the night, but only people already in
     *  (host, invited friends, existing RSVP credential) can reply. */
    inviteOnly: boolean('invite_only').notNull().default(false),
    /** Optional play format (e.g. 'commander'); NULL = undecided. Powers the
     *  host's "Start game" action, which seeds the Play tab's local setup. */
    format: text('format'),
  },
  (t) => ({
    hostIdx: index('game_nights_host_idx').on(t.hostUserId),
    startsIdx: index('game_nights_starts_idx').on(t.startsAt),
    // One occurrence per series slot — makes lazy materialization race-safe.
    seriesSlotIdx: uniqueIndex('game_nights_series_slot_idx')
      .on(t.seriesId, t.startsAt)
      .where(sql`series_id IS NOT NULL`),
  })
);

/**
 * A weekly recurring game night (E125). Deliberately template-free: the
 * "every Tue 7pm" shape lives in the series' latest occurrence — materializing
 * the next occurrence copies that night (title, place, notes, invites) one
 * DST-corrected week later, so editing this week's night IS editing the
 * template. The stable `token` powers the pinnable /gn/s/:token link, which
 * always resolves to the upcoming occurrence; mirroring the E123 contract,
 * unknown tokens 404 but an ended series stays resolvable to its last night.
 */
export const gameNightSeries = pgTable('game_night_series', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  hostUserId: text('host_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  /** Host pressed "stop repeating" — existing occurrences remain plain nights. */
  endedAt: bigint('ended_at', { mode: 'number' }),
});

/** Friends the host invited to a night. Their RSVP (if any) lives in `game_night_rsvps`. */
export const gameNightInvites = pgTable(
  'game_night_invites',
  {
    nightId: text('night_id')
      .notNull()
      .references(() => gameNights.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.nightId, t.userId] }),
    userIdx: index('game_night_invites_user_idx').on(t.userId),
  })
);

/**
 * Host-blocked accounts (block-on-remove): a removed, account-backed attendee
 * can also be blocked so they can't rejoin via the public link. Guests have no
 * stable identity to block — invite-only is the tool for them instead.
 */
export const gameNightBlocks = pgTable(
  'game_night_blocks',
  {
    nightId: text('night_id')
      .notNull()
      .references(() => gameNights.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.nightId, t.userId] }),
    userIdx: index('game_night_blocks_user_idx').on(t.userId),
  })
);

/**
 * RSVPs, from accounts and guests alike. Authed rows carry `userId` (one per
 * user per night, enforced by a partial unique index); guest rows have a NULL
 * `userId` and are edited by presenting the row `id`, which the RSVP endpoint
 * returned to that guest (a bearer credential the client stores locally — the
 * public read never exposes other people's row ids).
 */
/**
 * Candidate date slots while a night is polling for a date (E124). A night
 * with option rows is in the polling phase — the public page and Play-tab
 * card show voting UI instead of RSVP/calendar. `proposedBy` is the display
 * name of the attendee who suggested the slot (NULL = a host-created slot).
 * The host's "lock it in" deletes all options (cascading votes), flipping
 * the night back to the plain scheduled shape.
 */
export const gameNightOptions = pgTable(
  'game_night_options',
  {
    id: text('id').primaryKey(),
    nightId: text('night_id')
      .notNull()
      .references(() => gameNights.id, { onDelete: 'cascade' }),
    /** Epoch ms candidate start. While polling, the night's own startsAt mirrors the max slot. */
    startsAt: bigint('starts_at', { mode: 'number' }).notNull(),
    proposedBy: text('proposed_by'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (t) => ({
    nightIdx: index('game_night_options_night_idx').on(t.nightId),
  })
);

/**
 * "I can make this slot" checkmarks, multi-select per voter. The voter is
 * their rsvp row — so guests vote with the same stored rsvpId bearer
 * credential the RSVP flow uses, and signed-in users via their user row.
 */
export const gameNightVotes = pgTable(
  'game_night_votes',
  {
    optionId: text('option_id')
      .notNull()
      .references(() => gameNightOptions.id, { onDelete: 'cascade' }),
    rsvpId: text('rsvp_id')
      .notNull()
      .references(() => gameNightRsvps.id, { onDelete: 'cascade' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.optionId, t.rsvpId] }),
    rsvpIdx: index('game_night_votes_rsvp_idx').on(t.rsvpId),
  })
);

export const gameNightRsvps = pgTable(
  'game_night_rsvps',
  {
    id: text('id').primaryKey(),
    nightId: text('night_id')
      .notNull()
      .references(() => gameNights.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    displayName: text('display_name').notNull(),
    /** 'going' | 'maybe' | 'declined' */
    status: text('status').notNull().$type<'going' | 'maybe' | 'declined'>(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (t) => ({
    nightIdx: index('game_night_rsvps_night_idx').on(t.nightId),
  })
);

/**
 * One submitted feedback response against a kind='feedback' share (the
 * BlueprintMTG-style "feedback link" for a deck). The responder — signed in
 * or a guest — proposes card adds/cuts plus an overall comment and an
 * optional power-bracket read; the deck owner then accepts or rejects each
 * suggestion. Suggestions live as a JSONB array (see FeedbackSuggestion in
 * routes/feedback.ts) because they're only ever read/updated as a unit with
 * their response. `ownerUserId`/`deckId` are denormalized off the share so
 * the owner's "feedback for this deck" listing survives token revocation.
 */
export const deckFeedback = pgTable(
  'deck_feedback',
  {
    id: text('id').primaryKey(),
    shareToken: text('share_token')
      .notNull()
      .references(() => shares.token, { onDelete: 'cascade' }),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deckId: text('deck_id').notNull(),
    /** NULL for guest responders (name captured in authorName instead). */
    authorUserId: text('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    authorName: text('author_name').notNull(),
    comment: text('comment').notNull().default(''),
    /** Responder's power-bracket read of the deck (1–5); NULL = no opinion. */
    bracketSuggestion: integer('bracket_suggestion'),
    suggestions: jsonb('suggestions').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (t) => ({
    deckIdx: index('deck_feedback_deck_idx').on(t.ownerUserId, t.deckId),
    tokenIdx: index('deck_feedback_token_idx').on(t.shareToken),
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

/**
 * Canonical record of a finished *online* game, keyed by the live session id.
 * Unlike `user_games` (per-user, synced, one divergent copy each), this is a
 * single shared row every participant reads, so head-to-head and leaderboards
 * have one source of truth. Written once when an online game flips to
 * 'finished' (see `games/persist-result.ts`); never swept. Local games (no
 * authed participants) are not recorded.
 */
export const gameResults = pgTable(
  'game_results',
  {
    /** The `game_sessions.id` (UUID) — natural idempotency key. */
    sessionId: text('session_id').primaryKey(),
    code: text('code').notNull(),
    format: text('format').notNull(),
    startingLife: integer('starting_life').notNull(),
    winnerSeat: integer('winner_seat'),
    winnerUserId: text('winner_user_id'),
    startedAt: bigint('started_at', { mode: 'number' }),
    endedAt: bigint('ended_at', { mode: 'number' }).notNull(),
    durationMs: bigint('duration_ms', { mode: 'number' }).notNull(),
    /** One object per seat; see GameResultParticipant in games/result-types.ts. */
    participants: jsonb('participants').notNull().$type<GameResultParticipant[]>(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (t) => ({
    endedIdx: index('game_results_ended_idx').on(t.endedAt),
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
export type DeckFeedbackRow = typeof deckFeedback.$inferSelect;
export type GameNightRow = typeof gameNights.$inferSelect;
export type GameNightSeriesRow = typeof gameNightSeries.$inferSelect;
export type GameNightInviteRow = typeof gameNightInvites.$inferSelect;
export type GameNightBlockRow = typeof gameNightBlocks.$inferSelect;
export type GameNightRsvpRow = typeof gameNightRsvps.$inferSelect;
export type GameNightOptionRow = typeof gameNightOptions.$inferSelect;
export type GameNightVoteRow = typeof gameNightVotes.$inferSelect;
export type FriendshipRow = typeof friendships.$inferSelect;
export type GameResultRow = typeof gameResults.$inferSelect;
