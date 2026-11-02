// Paste a cube list (plain names, Draftmancer cube text, or a CubeCobra /
// generic CSV) and resolve it into the same ImportedCube the CubeCobra link
// import produces, so the ownership overlay and "Build my version" apply.
// Parsing is the server's import parser (/api/import-deck), shared with every
// other import in the app.

import { importDeckText } from '@/lib/api';
import type { ScryfallCard } from '@/deck-builder/types';
import { CubeImportError, type CubeCobraCard, type ImportedCube } from './import';

/**
 * Drop Draftmancer's structure so the card lines parse as a plain list:
 * `#` comments, `[Settings]` and its JSON body, and `[Sheet]` / `[Slot(15)]`
 * section headers. Card lines (`8 Forest (ANA) 60`) are kept as they are.
 */
export function stripDraftmancerStructure(text: string): string {
  const out: string[] = [];
  let inSettings = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^\[.*\]/.test(line)) {
      inSettings = /^\[settings\]/i.test(line);
      // A sheet header may carry JSON on the same line; none of it is a card.
      continue;
    }
    if (inSettings) continue;
    if (line.startsWith('#')) continue;
    out.push(raw);
  }
  return out.join('\n');
}

function toImportCard(c: ScryfallCard): CubeCobraCard {
  const face = c.card_faces?.[0];
  return {
    name: c.name,
    oracleId: c.oracle_id ?? '',
    cmc: c.cmc ?? 0,
    typeLine: c.type_line ?? face?.type_line ?? '',
    colors: c.colors ?? face?.colors ?? [],
    image: c.image_uris?.small ?? face?.image_uris?.small,
  };
}

/** Pure half: resolved cards → ImportedCube, one entry per distinct card. */
export function cubeFromResolvedCards(cards: ScryfallCard[], name = 'Pasted list'): ImportedCube {
  const seen = new Set<string>();
  const unique: CubeCobraCard[] = [];
  for (const c of cards) {
    const key = c.oracle_id || c.name;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(toImportCard(c));
  }
  return { id: 'pasted', name, cardCount: unique.length, likeCount: 0, cards: unique };
}

export interface PastedCube {
  cube: ImportedCube;
  /** Names the card service could not match; shown so a typo is visible. */
  unresolved: string[];
}

export async function importPastedCube(text: string): Promise<PastedCube> {
  const cleaned = stripDraftmancerStructure(text);
  if (!cleaned.trim()) throw new CubeImportError('Paste a card list to import.');
  const res = await importDeckText(cleaned);
  // The server files rows by section; a cube takes all of them.
  const all = [
    ...(res.commander ? [res.commander] : []),
    ...(res.companion ? [res.companion] : []),
    ...res.cards,
    ...(res.sideboard ?? []),
    ...(res.considering ?? []),
  ];
  const cube = cubeFromResolvedCards(all);
  if (cube.cards.length === 0) throw new CubeImportError("Couldn't match any cards in that list.");
  return { cube, unresolved: res.unresolvedNames };
}
