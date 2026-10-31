import fs from 'node:fs';
import path from 'node:path';
import {
  createComboVotes,
  type ComboVotes,
  type ComboVoteSnapshot,
} from '@spellcontrol/deck-metrics';
import { logger } from '../logger';

/**
 * EDHREC's community early/late vote on two-card combos, for the bracket estimator
 * behind `check_bracket` (E1053). The same committed `combo-votes.json` the
 * frontend loads, found the way `tags.ts` finds `tagger-tags.json`: in the image
 * Vite copies `frontend/public` into `backend/public`; in a dev checkout it is
 * the frontend's source copy.
 *
 * Unlike the tag data, a missing file is not a wrong answer: every combo then
 * reads as unvoted and the estimate falls back to the Spellbook tag and the
 * list's own speed, which is what it did before the votes. So this returns
 * `undefined` and logs once, instead of switching the tool off.
 */
function candidatePaths(): string[] {
  return [
    path.join(process.cwd(), 'public', 'combo-votes.json'),
    path.join(process.cwd(), '..', 'frontend', 'public', 'combo-votes.json'),
  ];
}

let cached: ComboVotes | undefined;
let attempted = false;

export function getComboVotes(): ComboVotes | undefined {
  if (attempted) return cached;
  attempted = true;
  for (const file of candidatePaths()) {
    try {
      if (!fs.existsSync(file)) continue;
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as ComboVoteSnapshot;
      cached = createComboVotes(parsed);
      logger.info(`[ai] combo votes loaded from ${file} (${cached.size} combos)`);
      return cached;
    } catch (err) {
      logger.error(`[ai] failed to read combo votes at ${file}`, err);
    }
  }
  logger.warn('[ai] no combo vote data found; check_bracket reads every combo as unvoted');
  return undefined;
}

/** Test seam: the memo would otherwise leak a result between cases. */
export function __resetComboVotes(): void {
  cached = undefined;
  attempted = false;
}
