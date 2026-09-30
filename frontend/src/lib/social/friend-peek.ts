import type { Friend } from './friends-client';

/** "3 decks · Brews Atraxa", or the honest "No public decks yet". */
export function friendPeekLine(friend: Friend): string {
  const decks = friend.deckCount ?? 0;
  if (decks === 0) return 'No public decks yet';
  const parts = [`${decks} ${decks === 1 ? 'deck' : 'decks'}`];
  if (friend.topCommander) parts.push(`Brews ${friend.topCommander}`);
  return parts.join(' · ');
}
