import type { ScryfallCard } from '@/deck-builder/types';
import { peekCommanderThemes } from '../edhrec/commander-page-cache';
import { buildCommanderProfile, type CommanderProfile } from './commanderProfile';

/**
 * The profile for surfaces that never fetch the commander's EDHREC page: it reads the
 * page's themes (the Voltron veto) when another surface already cached them, and falls
 * back to the text reading when it did not. Makes no request.
 */
export function buildCommanderProfileFromCache(
  commander: ScryfallCard,
  partner?: ScryfallCard | null
): CommanderProfile {
  return buildCommanderProfile(commander, partner, {
    edhrecThemes: peekCommanderThemes(commander.name, partner?.name),
  });
}
