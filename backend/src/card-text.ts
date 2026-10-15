import type { ScryfallCard } from './types';

/**
 * The one place a card's rules text, type line and mana cost are flattened
 * across its faces.
 *
 * Scryfall leaves the top-level `oracle_text` empty on every layout that keeps
 * its text per face (transform, modal_dfc, adventure, split, flip, prepare,
 * reversible_card), and leaves `mana_cost` empty on transform / modal_dfc, so a
 * reader of the top level alone sees a blank card. Two readers need the faces:
 * the card_search index (so a back face's ability is findable) and the AI's
 * Card reference (so the model reads the card instead of guessing from its name).
 */
export interface CardFaceText {
  manaCost: string;
  typeLine: string;
  oracleText: string;
}

/**
 * `labelFaces` prefixes each face's text with its name, "Front: text\n//\nBack:
 * text", so a reader can tell which face does what. The AI Card reference wants
 * that; the search index does not (it would only add face names as match terms).
 */
export function cardFaceText(
  card: Pick<ScryfallCard, 'mana_cost' | 'type_line' | 'oracle_text' | 'card_faces'>,
  opts: { labelFaces?: boolean } = {}
): CardFaceText {
  const faces = card.card_faces ?? [];
  const oracleText =
    card.oracle_text ||
    faces
      .filter((f) => f.oracle_text)
      .map((f) => (opts.labelFaces && f.name ? `${f.name}: ${f.oracle_text}` : f.oracle_text))
      .join('\n//\n');
  const typeLine =
    card.type_line ||
    faces
      .map((f) => f.type_line ?? '')
      .filter(Boolean)
      .join(' // ');
  const manaCost =
    card.mana_cost ||
    faces
      .map((f) => f.mana_cost ?? '')
      .filter(Boolean)
      .join(' // ');
  return { manaCost, typeLine, oracleText };
}
