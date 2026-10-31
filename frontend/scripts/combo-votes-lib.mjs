// Pure half of refresh-combo-votes.mjs: turns EDHREC's community-vote combo lists into the
// compact snapshot the bracket estimator reads. No I/O, so the thresholds are testable.

// EDHREC's two lists: voted executable before about turn 6 (Brackets 4 and 5 only), and voted
// not typically executable before turn 6 (Bracket 3). Both are paged: page 1 carries
// container.json_dict.cardlists and a `more` path, the later pages are flat.
export const LISTS = {
  early: 'early-game-2-card-combos',
  late: 'late-game-2-card-combos',
};

// Votes needed before a verdict counts. Measured on the 2026-10-31 pull (1,435 early and 717
// late entries): 13 votes is where EDHREC's own lists start (9 early and 5 late entries sit
// under it, 0.6% and 0.7%), so the floor only trims the thinnest tail rather than carving a
// new cut through the bulk of the data.
export const MIN_VOTES = 13;

/** Is this list entry a verdict we will act on? */
export function isUsableVote(entry, kind) {
  const combo = entry?.combo;
  const vote = combo?.comboVote;
  if (!combo || !vote || typeof combo.comboId !== 'string') return false;
  // The estimator reasons about two-card combos; a wider combo would be a different claim.
  if (!Array.isArray(combo.cardIds) || combo.cardIds.length !== 2) return false;
  if (vote.controversial) return false; // voters split: the heuristics decide
  if (!(vote.voteCount >= MIN_VOTES)) return false;
  // The page title scopes each list; a bracket label that disagrees with it is a changed
  // list, not a vote to trust.
  return kind === 'early' ? vote.bracket === '4-5' : vote.bracket === '3';
}

/** `{ early: string[], late: string[] }` of sorted Spellbook ids from the raw entries. */
export function pickVotes(entriesByKind) {
  const out = {};
  for (const kind of ['early', 'late']) {
    out[kind] = [
      ...new Set(
        (entriesByKind[kind] ?? []).filter((e) => isUsableVote(e, kind)).map((e) => e.combo.comboId)
      ),
    ].sort();
  }
  // An id on both lists would be two opposite verdicts; drop it from both.
  const both = new Set(out.early.filter((id) => out.late.includes(id)));
  out.early = out.early.filter((id) => !both.has(id));
  out.late = out.late.filter((id) => !both.has(id));
  return out;
}
