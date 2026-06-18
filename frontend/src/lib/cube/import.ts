// Import a cube from CubeCobra and overlay it against the user's collection.
//
// CubeCobra's cubeJSON endpoint is public, CORS `*`, and Scryfall-keyed, so we
// fetch it straight from the browser — no backend proxy. 100 req/min/IP.

export interface CubeCobraCard {
  name: string;
  oracleId: string;
  cmc: number;
  typeLine: string;
  colors: string[];
}

export interface ImportedCube {
  id: string;
  name: string;
  cardCount: number;
  likeCount: number;
  cards: CubeCobraCard[];
}

/** Tri-state ownership, matching the app's `ChangeOwnership`. */
export type Ownership = 'owned' | 'in-other-deck' | 'unowned';

export interface OwnershipOverlay {
  rows: { card: CubeCobraCard; ownership: Ownership }[];
  owned: number;
  inDeck: number;
  missing: number;
  /** Share of the cube the user can field from free copies (0–1). */
  pctComplete: number;
}

export class CubeImportError extends Error {}

/**
 * Pull a cube id/slug out of a CubeCobra URL, or accept a bare id.
 * Handles /cube/overview|list|playtest|history/:id and trailing slashes/queries.
 */
export function parseCubeId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/cubecobra\.com\/cube\/[a-z]+\/([^/?#]+)/i);
  if (m) return decodeURIComponent(m[1]);
  // A bare slug/id (no slashes, no spaces) is usable as-is.
  if (/^[A-Za-z0-9_-]+$/.test(trimmed)) return trimmed;
  return null;
}

// CubeCobra cards carry canonical Scryfall fields under `details` (always
// present); top-level name/type/cmc/colors are optional. Read details-first.
interface RawCard {
  name?: string;
  type_line?: string;
  cmc?: number | string;
  colors?: string[];
  details?: {
    name?: string;
    type?: string;
    type_line?: string;
    cmc?: number;
    colors?: string[];
    oracle_id?: string;
  };
}

function normalizeCard(c: RawCard): CubeCobraCard | null {
  const name = c.details?.name ?? c.name;
  if (!name) return null;
  return {
    name,
    oracleId: c.details?.oracle_id ?? '',
    typeLine: c.details?.type_line ?? c.details?.type ?? c.type_line ?? '',
    cmc: Number(c.details?.cmc ?? c.cmc ?? 0) || 0,
    colors: c.details?.colors ?? c.colors ?? [],
  };
}

export async function fetchCubeCobraCube(input: string): Promise<ImportedCube> {
  const id = parseCubeId(input);
  if (!id) throw new CubeImportError("That doesn't look like a CubeCobra cube link.");

  let res: Response;
  try {
    res = await fetch(`https://cubecobra.com/cube/api/cubeJSON/${encodeURIComponent(id)}`);
  } catch {
    throw new CubeImportError('Could not reach CubeCobra. Check your connection and try again.');
  }
  if (res.status === 404) throw new CubeImportError(`No public cube found for "${id}".`);
  if (res.status === 429)
    throw new CubeImportError('CubeCobra is rate-limiting requests — wait a minute and retry.');
  if (!res.ok) throw new CubeImportError(`CubeCobra returned an error (${res.status}).`);

  const data = await res.json();
  const main: RawCard[] = data?.cards?.mainboard ?? [];
  const cards = main.map(normalizeCard).filter((c): c is CubeCobraCard => c !== null);
  if (cards.length === 0) throw new CubeImportError('That cube appears to be empty.');

  return {
    id: data.id ?? id,
    name: data.name ?? 'Cube',
    cardCount: data.cardCount ?? cards.length,
    likeCount: data.likeCount ?? 0,
    cards,
  };
}

/** Overlay a cube's cards against collection ownership (pure — caller supplies `ownershipFor`). */
export function overlayOwnership(
  cards: CubeCobraCard[],
  ownershipFor: (name: string) => Ownership
): OwnershipOverlay {
  const rows = cards.map((card) => ({ card, ownership: ownershipFor(card.name) }));
  const owned = rows.filter((r) => r.ownership === 'owned').length;
  const inDeck = rows.filter((r) => r.ownership === 'in-other-deck').length;
  const missing = rows.filter((r) => r.ownership === 'unowned').length;
  return {
    rows,
    owned,
    inDeck,
    missing,
    pctComplete: cards.length ? owned / cards.length : 0,
  };
}
