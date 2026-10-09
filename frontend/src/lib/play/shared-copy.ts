/**
 * Play strings stated on more than one surface (STYLE_GUIDE § Voice & copy,
 * rule 18). One constant per fact, so the wordings can't drift apart again.
 */

/** Body of every confirm that throws away the game in progress. */
export const DISCARD_GAME_BODY = 'Your current game is discarded, not saved to History.';

/** Body of the confirm that replaces a Horde fight with a rematch. */
export const DISCARD_HORDE_BODY = 'The fight in progress is discarded, not saved to History.';

/** Verdict line for a finished game nobody won. */
export const GAME_OVER_NO_WINNER = 'Game over. No winner.';

/** Body of the leave confirm when nobody can take the table over. `others` counts the seats left behind. */
export function endTableBody(others: number): string {
  if (others <= 0) return 'Leaving ends the table.';
  return `Leaving ends the table for ${others === 1 ? 'the other player' : `all ${others} other players`} still seated.`;
}

/** Visibility choices for an online table, shared by the setup form and the lobby. */
export const TABLE_VISIBILITY_OPTIONS: {
  value: 'public' | 'friends' | 'private';
  label: string;
  hint: string;
}[] = [
  {
    value: 'public',
    label: 'Public',
    hint: 'Listed in the room browser. Anyone can watch.',
  },
  {
    value: 'friends',
    label: 'Friends',
    hint: 'Listed for your friends. They can watch.',
  },
  { value: 'private', label: 'Private', hint: 'Not listed. Only people with the code can join.' },
];
