import type { EnrichedCard } from '../types';
import type { ScryfallCard } from '@/deck-builder/types';

/* Pure view-model helpers for the card-preview detail blocks (CardText /
   CardLegalities). Kept out of the component file so they're unit-testable and
   the component module stays Fast-Refresh-clean (components-only export). */

export interface CardFace {
  name?: string;
  typeLine?: string;
  manaCost?: string;
  oracleText?: string;
  flavorText?: string;
  /** "3/4" for creatures. */
  pt?: string;
  /** Starting loyalty / defense for planeswalkers / battles. */
  loyalty?: string;
}

function ptOf(o: { power?: string; toughness?: string }): string | undefined {
  return o.power != null && o.toughness != null ? `${o.power}/${o.toughness}` : undefined;
}

/**
 * The rules-text faces to render. Uses the live Scryfall card when available
 * (structured per-face, with flavor + P/T) and falls back to the
 * already-on-hand `EnrichedCard.oracleText` (faces pre-joined with `//`) so
 * something shows instantly / offline before the live fetch resolves.
 */
export function cardFaces(card: EnrichedCard, detail: ScryfallCard | null): CardFace[] {
  if (detail?.card_faces && detail.card_faces.length > 1) {
    return detail.card_faces.map((f) => ({
      name: f.name,
      typeLine: f.type_line,
      manaCost: f.mana_cost,
      oracleText: f.oracle_text,
      flavorText: f.flavor_text,
      pt: ptOf(f),
      loyalty: f.loyalty,
    }));
  }
  const oracleText = detail?.oracle_text ?? card.oracleText;
  const face: CardFace = {
    oracleText,
    flavorText: detail?.flavor_text,
    pt: detail ? ptOf(detail) : undefined,
    loyalty: detail?.loyalty,
  };
  return oracleText || face.flavorText || face.pt || face.loyalty ? [face] : [];
}

/**
 * A leading "keyword line" in a rules box — the comma-separated innate keywords
 * (Flying, Menace, Trample, Equip {2}) that head a card's oracle text, as
 * opposed to a full ability sentence. Reminder text is stripped first; anything
 * with sentence/mode/bullet punctuation (`. : • —`) is an ability, not keywords.
 */
export function isKeywordLine(line: string): boolean {
  const t = line.replace(/\s*\([^)]*\)/g, '').trim();
  if (!t) return false;
  if (/[.:•—]/.test(t)) return false;
  return t.length <= 40;
}

const LEGALITY_FORMATS: ReadonlyArray<readonly [string, string]> = [
  ['standard', 'Standard'],
  ['pioneer', 'Pioneer'],
  ['modern', 'Modern'],
  ['legacy', 'Legacy'],
  ['vintage', 'Vintage'],
  ['pauper', 'Pauper'],
  ['commander', 'Commander'],
  ['brawl', 'Brawl'],
  ['alchemy', 'Alchemy'],
  ['historic', 'Historic'],
  ['penny', 'Penny'],
  ['oathbreaker', 'Oathbreaker'],
];

/** Display label for a Scryfall legality-format key ("commander" → "Commander").
 *  Falls back to capitalizing unknown keys so new formats degrade readably. */
export function legalityFormatLabel(key: string | undefined): string {
  if (!key) return 'format';
  const hit = LEGALITY_FORMATS.find(([k]) => k === key);
  return hit ? hit[1] : key.charAt(0).toUpperCase() + key.slice(1);
}

export type LegalityStatus = 'legal' | 'not_legal' | 'banned' | 'restricted';

const STATUS_LABEL: Record<LegalityStatus, string> = {
  legal: 'Legal',
  not_legal: 'Not legal',
  banned: 'Banned',
  restricted: 'Restricted',
};

export interface LegalityRow {
  key: string;
  label: string;
  status: LegalityStatus;
  statusLabel: string;
}

export function legalityRows(legalities: Record<string, string> | undefined): LegalityRow[] {
  if (!legalities) return [];
  const rows: LegalityRow[] = [];
  for (const [key, label] of LEGALITY_FORMATS) {
    const raw = legalities[key];
    if (!raw) continue;
    const status: LegalityStatus =
      raw === 'legal' || raw === 'banned' || raw === 'restricted' ? raw : 'not_legal';
    rows.push({ key, label, status, statusLabel: STATUS_LABEL[status] });
  }
  return rows;
}
