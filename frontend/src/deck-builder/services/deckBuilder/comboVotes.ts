import {
  createComboVotes,
  type ComboVotes,
  type ComboVoteSnapshot,
} from '@spellcontrol/deck-metrics';
import { logger } from '@/lib/util/logger';

/**
 * EDHREC's community vote on when a two-card combo comes together, from the
 * committed `public/combo-votes.json` that `scripts/refresh-combo-votes.mjs`
 * writes (E1053). The bracket estimator takes it as injected data
 * (`@spellcontrol/deck-metrics`); `estimateBracket` in `bracketEstimator.ts`
 * reads it from here, so none of its call sites change.
 *
 * Loaded where a bracket is first computed (`analyzeCommanderDeck`, the
 * generator's combo-tag step), never on the boot path. Until it has loaded,
 * `getComboVotes()` is `undefined` and every combo reads as unvoted: the
 * Spellbook tag and the deck's own speed decide, as they did before the votes.
 * A failed load leaves it that way and is not retried within the session.
 */
let votes: ComboVotes | undefined;
let loading: Promise<void> | null = null;

export function loadComboVotes(): Promise<void> {
  loading ??= fetch('/combo-votes.json')
    .then((res) => {
      if (!res.ok) throw new Error(`combo-votes.json ${res.status}`);
      return res.json() as Promise<ComboVoteSnapshot>;
    })
    .then((snapshot) => {
      votes = createComboVotes(snapshot);
    })
    .catch((e: unknown) => {
      logger.warn('combo vote snapshot unavailable; the Spellbook tag decides', e);
    });
  return loading;
}

/** The votes once loaded; undefined until then. */
export function getComboVotes(): ComboVotes | undefined {
  return votes;
}

/** Test seam: install votes directly, or pass undefined to forget them. */
export function setComboVotesForTests(next: ComboVotes | undefined): void {
  votes = next;
  loading = next ? Promise.resolve() : null;
}
