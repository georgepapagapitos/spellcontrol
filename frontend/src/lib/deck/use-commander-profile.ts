import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';
import { onCommanderPageCached, peekCommanderThemes } from '@/deck-builder/services/edhrec/client';
import {
  buildCommanderProfile,
  type CommanderProfile,
} from '@/deck-builder/services/deckBuilder/commanderProfile';

/**
 * The commander's profile for a screen. It reads the oracle text, plus the EDHREC page's
 * themes (the Voltron veto) once any surface has cached that page. It makes no request and
 * never delays a render: until the page lands the text decides, then the profile rebuilds.
 */
export function useCommanderProfile(
  commander: ScryfallCard | null | undefined,
  partner?: ScryfallCard | null
): CommanderProfile | null {
  const name = commander?.name;
  const partnerName = partner?.name;
  const read = useCallback(
    () => (name ? peekCommanderThemes(name, partnerName) : undefined),
    [name, partnerName]
  );
  const edhrecThemes = useSyncExternalStore(onCommanderPageCached, read, () => undefined);
  return useMemo(
    () => (commander ? buildCommanderProfile(commander, partner, { edhrecThemes }) : null),
    [commander, partner, edhrecThemes]
  );
}
