/**
 * Formats one user's identity for display: prefer their display name, with
 * `@username` kept as a secondary line only when a display name is actually
 * set. Shared by every surface that renders another user's identity —
 * friends, requests, inbox, RSVPs, live-game seats, feedback authorship,
 * leaderboard/H2H, and shared-content attribution.
 */
export function formatIdentity(identity: { username: string; displayName?: string | null }): {
  primary: string;
  secondary: string | null;
} {
  const trimmed = identity.displayName?.trim();
  return {
    primary: trimmed || identity.username,
    // null (not '') so every call site can do `{secondary && <span>...}` with
    // no extra guard.
    secondary: trimmed ? `@${identity.username}` : null,
  };
}

/**
 * The same identity as one **unframed** label, for a surface with no "by …"
 * or "Shared by …" wording and no avatar to mark it as a person: the display
 * name when one is set, otherwise `@username`. The "@" is what makes a bare
 * username read as a handle rather than as someone's unset display name.
 *
 * Framed call sites (`by {name}`, an avatar + name row) want
 * `formatIdentity(...).primary` instead — the framing already does this job,
 * and an "@" inside it reads as noise.
 */
export function standaloneIdentity(identity: {
  username: string;
  displayName?: string | null;
}): string {
  const { primary, secondary } = formatIdentity(identity);
  return secondary ? primary : `@${identity.username}`;
}
