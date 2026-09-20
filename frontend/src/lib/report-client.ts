import { apiUrl } from './api-base';

export type ReportKind = 'deck' | 'profile' | 'game-result';

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body?.error ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Submit a content report. Works signed out (the server runs `optionalAuth`,
 * not `requireAuth`) — credentials are included so a signed-in reporter's
 * user id still attaches, but no session is required. The server resolves
 * the current owner itself; this never sends anything but kind/targetId/reason.
 * Throws with the server's message on failure, including the distinct
 * "no longer available" copy for a target that's already been taken down.
 */
export async function submitReport(input: {
  kind: ReportKind;
  targetId: string;
  reason: string;
}): Promise<void> {
  const res = await fetch(apiUrl('/api/reports'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    // The 5/min limiter's rejection is a plain-text body, not JSON — routed
    // on the status code rather than sniffing that text, since a proxy or a
    // future limiter message shouldn't change which branch this takes.
    if (res.status === 429) {
      throw new Error("You've sent a few reports already. Try again in a minute.");
    }
    throw new Error(await readError(res, "Couldn't send your report. Try again."));
  }
}
