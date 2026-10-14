import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ScryfallCard } from '@/deck-builder/types';
import {
  onCommanderPageCached,
  peekCommanderThemes,
} from '@/deck-builder/services/edhrec/commander-page-cache';
import {
  fetchCommanderData,
  fetchPartnerCommanderData,
} from '@/deck-builder/services/edhrec/client';
import {
  buildCommanderProfile,
  type CommanderProfile,
} from '@/deck-builder/services/deckBuilder/commanderProfile';
import { isVoltronVetoedByName, useVoltronVeto } from './commander-voltron-veto';

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
  // The shipped snapshot stands in until (or unless) the page is cached, so this profile and the
  // finder's playstyle chips never disagree. A pair has its own page, so only a lone commander.
  const veto = useVoltronVeto();
  const snapshotVetoed = !partner && !!name && isVoltronVetoedByName(veto, name);
  return useMemo(
    () =>
      commander
        ? buildCommanderProfile(commander, partner, {
            edhrecThemes,
            voltronVetoed: snapshotVetoed,
          })
        : null,
    [commander, partner, edhrecThemes, snapshotVetoed]
  );
}

/**
 * The deck editor's half: a deck reopened with its analysis saved never fetches the commander's
 * page, so nothing would hold the themes the profile reads. Fetch it once when no surface has
 * (the session caches it), without blocking anything; offline or a failure leaves the text reading.
 */
export function useWarmCommanderPage(
  commander: ScryfallCard | null | undefined,
  partner?: ScryfallCard | null
): void {
  const name = commander?.name;
  const partnerName = partner?.name;
  useEffect(() => {
    if (!name || peekCommanderThemes(name, partnerName)) return;
    const page = partnerName
      ? fetchPartnerCommanderData(name, partnerName)
      : fetchCommanderData(name);
    page.catch(() => {});
  }, [name, partnerName]);
}
