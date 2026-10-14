import { useEffect, useState } from 'react';
import { frontFaceName } from '@/lib/cards/card-text';
import { logger } from '@/lib/util/logger';

/**
 * The commanders whose EDHREC page says almost nobody builds them as Voltron (golden R11),
 * from the committed `public/voltron-veto.json` that `scripts/refresh-voltron-veto.mjs` writes.
 * The finder and the collection list many commanders at once and fetch no pages, so this is how
 * their "Plays like" chips and the Voltron filter reach the same answer the commander profile
 * gives. It loads where those surfaces load (never on the boot path) and a failure leaves the
 * text reading alone.
 */
export type VoltronVeto = ReadonlySet<string>;

let loaded: Promise<VoltronVeto> | null = null;

/** The snapshot key for a card name: front face, lowercased. */
export function voltronVetoKey(name: string): string {
  return frontFaceName(name).toLowerCase();
}

export function isVoltronVetoedByName(veto: VoltronVeto | null | undefined, name: string): boolean {
  return !!veto && veto.has(voltronVetoKey(name));
}

export function loadVoltronVeto(): Promise<VoltronVeto> {
  loaded ??= fetch('/voltron-veto.json')
    .then((res) => {
      if (!res.ok) throw new Error(`voltron-veto.json ${res.status}`);
      return res.json() as Promise<{ names?: string[] }>;
    })
    .then((data) => new Set(data.names ?? []) as VoltronVeto)
    .catch((e: unknown) => {
      logger.warn('voltron veto snapshot unavailable; the card text decides', e);
      loaded = null;
      return new Set<string>() as VoltronVeto;
    });
  return loaded;
}

/** The snapshot once it has loaded; null until then (the text reads in the meantime). */
export function useVoltronVeto(): VoltronVeto | null {
  const [veto, setVeto] = useState<VoltronVeto | null>(null);
  useEffect(() => {
    let live = true;
    void loadVoltronVeto().then((v) => {
      if (live) setVeto(v);
    });
    return () => {
      live = false;
    };
  }, []);
  return veto;
}

/** Test seam: forget the loaded snapshot. */
export function resetVoltronVetoForTests(): void {
  loaded = null;
}
