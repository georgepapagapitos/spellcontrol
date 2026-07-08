/**
 * Public share payload types. Mirror backend/src/shares/projections.ts —
 * keep these in lockstep when fields change. Backend is the contract; this
 * file is what the frontend renders the SharedView page from.
 */

/** 'feedback' is a deck share whose viewers can also submit suggestions —
 *  same PublicDeck payload, different viewer UI. */
export type ShareKind = 'collection' | 'binder' | 'deck' | 'list' | 'cube' | 'feedback';

/** Who can open a share. 'direct' = addressed to one friend (the addressee). */
export type ShareAudience = 'link' | 'friends' | 'direct';

export interface ShareRow {
  token: string;
  userId: string;
  kind: ShareKind;
  resourceId: string;
  audience: ShareAudience;
  /** Recipient user id for audience='direct'; null otherwise. */
  addresseeId: string | null;
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
  /** Facet fields for the shared-view filter (oracle text / format legality /
   *  treatment / border). `legalities` is trimmed server-side to the filterable
   *  formats. Mirror backend projectCard. */
  oracleText?: string;
  legalities?: Record<string, string>;
  frameEffects?: string[];
  fullArt?: boolean;
  borderColor?: string;
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

/** One grouped section of a shared binder (color / type / rarity / … bucket). */
export interface PublicBinderSection {
  key: string;
  label: string;
  /** Color-pip styling — present only when the binder groups by color. */
  pip?: { background: string; border: string };
  cards: PublicCard[];
}

export interface PublicBinder {
  ownerUsername: string;
  id: string;
  name: string;
  color: string;
  /** The binder's live contents, grouped into the owner's sections. */
  sections: PublicBinderSection[];
  totalCards: number;
  totalValue: number;
  updatedAt?: number;
}

/** One card in a shared cube — oracle-level, plus the bucket it filled. */
export interface PublicCubeCard {
  name: string;
  oracleId: string;
  colors: string[];
  cmc: number;
  typeLine: string;
  bucket: string;
  reason: string;
}

export interface PublicCubeGap {
  severity: 'short' | 'note';
  text: string;
}

export interface PublicCube {
  ownerUsername: string;
  id: string;
  name: string;
  size: number;
  cards: PublicCubeCard[];
  byBucket: Record<string, number>;
  targetByBucket: Record<string, number>;
  gaps: PublicCubeGap[];
  shortfall: number;
  poolSize: number;
  savedAt?: number;
}

export type PublicShareResponse =
  | { kind: 'collection'; data: PublicCollection }
  | { kind: 'binder'; data: PublicBinder }
  | { kind: 'deck'; data: PublicDeck }
  | { kind: 'feedback'; data: PublicDeck }
  | { kind: 'list'; data: PublicList }
  | { kind: 'cube'; data: PublicCube };
