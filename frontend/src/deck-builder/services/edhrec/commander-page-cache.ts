import type { EDHRECCommanderData, EDHRECTheme } from '@/deck-builder/types';
import { frontFaceName } from '@/lib/cards/card-text';

// The session's cache of commander pages, kept apart from the client so a surface that only
// reads it (peekCommanderThemes) never touches the network layer, and so a test that mocks the
// client still gets a real, empty cache.
export const commanderCache = new Map<string, { data: EDHRECCommanderData; timestamp: number }>();
export const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Listeners told when a commander's own page lands in the cache, so a surface that only
// reads the cache can re-read once another surface fetched it.
const commanderPageListeners = new Set<() => void>();
export function onCommanderPageCached(listener: () => void): () => void {
  commanderPageListeners.add(listener);
  return () => void commanderPageListeners.delete(listener);
}
export function notifyCommanderPageCached(): void {
  for (const notify of commanderPageListeners) notify();
}

/**
 * Format commander name for EDHREC URL
 * "Atraxa, Praetors' Voice" -> "atraxa-praetors-voice"
 * "Venat, Heart of Hydaelyn // Hydaelyn, the Mothercrystal" -> "venat-heart-of-hydaelyn"
 * "Clavileño, First of the Blessed" -> "clavileno-first-of-the-blessed"
 *
 * For double-faced cards (containing "//"), EDHREC uses only the front face name.
 */
export function formatCommanderNameForUrl(name: string): string {
  // Handle double-faced cards - use only the front face name
  const frontFace = frontFaceName(name);

  return frontFace
    .normalize('NFD') // Decompose accented chars (ñ -> n + combining tilde)
    .replace(/[\u0300-\u036f]/g, '') // Strip combining diacritical marks
    .toLowerCase()
    .replace(/[',]/g, '') // Remove apostrophes and commas
    .replace(/[^a-z0-9\s-]/g, '') // Remove other special characters (& etc.) before spacing
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-'); // Collapse multiple hyphens
}

export function getPartnerSlugs(commander1: string, commander2: string): [string, string] {
  const slug1 = formatCommanderNameForUrl(commander1);
  const slug2 = formatCommanderNameForUrl(commander2);
  // Primary: commander1 first, secondary: commander2 first
  return [`${slug1}-${slug2}`, `${slug2}-${slug1}`];
}

/**
 * The themes of a commander's (or pair's) own page when it is already cached, else
 * undefined. Never requests: for the surfaces that describe a commander without
 * having fetched its page. The default page only; a bracket or budget slice has
 * different theme shares.
 */
export function peekCommanderThemes(
  commanderName: string,
  partnerName?: string | null
): EDHRECTheme[] | undefined {
  const keys = partnerName
    ? getPartnerSlugs(commanderName, partnerName)
    : [formatCommanderNameForUrl(commanderName)];
  for (const key of keys) {
    const cached = commanderCache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL && cached.data.themes.length > 0) {
      return cached.data.themes;
    }
  }
  return undefined;
}
