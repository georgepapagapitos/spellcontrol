import { apiUrl } from '@/lib/api/api-base';

/**
 * The MPC Autofill order file for a deck's MPC list (`buildExport(…, 'mpc')`).
 * The server picks the top-ranked image per card (backend/src/mpc/order.ts);
 * the browser can't ask MPC Autofill itself, its CORS list is its own sites.
 */
export interface MpcOrder {
  xml: string;
  /** Card slots the order fills. */
  slots: number;
  /** List names MPC Autofill has no image for; left out of the file. */
  missing: string[];
}

export async function fetchMpcOrder(list: string): Promise<MpcOrder> {
  let res: Response;
  try {
    res = await fetch(apiUrl('/api/mpc/order'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ list }),
    });
  } catch {
    throw new Error("Couldn't reach SpellControl. Check your connection and try again.");
  }
  if (!res.ok) {
    let message = "Couldn't build the order file. Try again.";
    if (res.status === 429) message = 'Too many order files at once. Wait a minute and try again.';
    try {
      const body = (await res.json()) as { error?: string };
      if (res.status !== 429 && body?.error) message = body.error;
    } catch {
      /* keep the fallback */
    }
    throw new Error(message);
  }
  return (await res.json()) as MpcOrder;
}
