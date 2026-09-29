import { formatSocialCount } from './social-proof';
import type { BrewerCard } from './brewers-client';

/** "3 decks · 12 followers". Followers pass the same public-count floor as
 *  every other social number, so a brewer with two followers reads as decks
 *  only rather than a lonely "2 followers". */
export function brewerStatsLine(brewer: BrewerCard): string {
  const parts = [`${brewer.deckCount} ${brewer.deckCount === 1 ? 'deck' : 'decks'}`];
  const followers = formatSocialCount(brewer.followerCount);
  if (followers) {
    parts.push(`${followers} ${brewer.followerCount === 1 ? 'follower' : 'followers'}`);
  }
  return parts.join(' · ');
}
