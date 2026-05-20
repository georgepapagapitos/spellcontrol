/**
 * Public share payload types. Mirror backend/src/shares/projections.ts —
 * keep these in lockstep when fields change. Backend is the contract; this
 * file is what the frontend renders the SharedView page from.
 */

export type ShareKind = 'collection' | 'deck' | 'list';

export interface ShareRow {
  token: string;
  userId: string;
  kind: ShareKind;
  resourceId: string;
  createdAt: number;
  revokedAt: number | null;
}

export interface PublicCard {
  name: string;
  scryfallId: string;
  oracleId?: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  rarity: string;
  finish: 'nonfoil' | 'foil' | 'etched';
  foil: boolean;
  condition?: string;
  language?: string;
  altered?: boolean;
  proxy?: boolean;
  misprint?: boolean;
  purchasePrice: number;
  cmc?: number;
  typeLine?: string;
  colorIdentity?: string[];
  colors?: string[];
  imageSmall?: string;
  imageNormal?: string;
  imageNormalBack?: string;
  layout?: string;
  manaCost?: string;
}

export interface PublicCollection {
  ownerUsername: string;
  uploadedAt?: number;
  cards: PublicCard[];
}

export interface PublicListEntry {
  name: string;
  scryfallId: string;
  setCode: string;
  collectorNumber: string;
  finish: 'nonfoil' | 'foil' | 'etched';
  oracleId?: string;
  quantity: number;
  note?: string;
  targetPrice?: number;
}

export interface PublicList {
  ownerUsername: string;
  id: string;
  name: string;
  entries: PublicListEntry[];
  updatedAt?: number;
}

export interface PublicDeckCard {
  /** Inline ScryfallCard. Shape matches the owner's stored DeckCard.card. */
  card: {
    id?: string;
    name: string;
    image_uris?: { small?: string; normal?: string; large?: string };
    card_faces?: Array<{ image_uris?: { small?: string; normal?: string; large?: string } }>;
    type_line?: string;
    mana_cost?: string;
    cmc?: number;
    colors?: string[];
    color_identity?: string[];
    set?: string;
    set_name?: string;
    collector_number?: string;
    rarity?: string;
    [key: string]: unknown;
  };
}

export interface PublicDeck {
  ownerUsername: string;
  id: string;
  name: string;
  format: string;
  commander: PublicDeckCard['card'] | null;
  partnerCommander: PublicDeckCard['card'] | null;
  cards: PublicDeckCard[];
  sideboard: PublicDeckCard[];
  color: string;
  averageSalt?: number;
  bracketEstimation?: unknown;
  deckGrade?: { letter: string; headline: string };
  updatedAt?: number;
}

export type PublicShareResponse =
  | { kind: 'collection'; data: PublicCollection }
  | { kind: 'deck'; data: PublicDeck }
  | { kind: 'list'; data: PublicList };
