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
