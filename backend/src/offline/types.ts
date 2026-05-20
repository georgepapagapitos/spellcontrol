/**
 * Shapes served by /api/offline/*. The frontend stores SlimCard rows in
 * IndexedDB and reads them when offline mode is enabled.
 *
 * SlimCard is a deliberate subset of ScryfallCard: just the fields the
 * deck builder, combo matcher, and card-search UI actually read. Trimming
 * cuts the oracle bulk from ~180MB to ~30MB raw (~8MB gzipped).
 */

export interface SlimCardFace {
  name: string;
  manaCost?: string;
  typeLine?: string;
  oracleText?: string;
  colors?: string[];
  imageSmall?: string;
  imageNormal?: string;
  imageLarge?: string;
}

export interface SlimCard {
  oracleId: string;
  scryfallId: string;
  name: string;
  manaCost?: string;
  cmc: number;
  typeLine: string;
  oracleText?: string;
  colors: string[];
  colorIdentity: string[];
  keywords: string[];
  producedMana?: string[];
  layout?: string;
  legalities: Record<string, string>;
  edhrecRank?: number;
  set: string;
  setName?: string;
  collectorNumber?: string;
  releasedAt?: string;
  imageSmall?: string;
  imageNormal?: string;
  imageLarge?: string;
  faces?: SlimCardFace[];
  usdPrice?: string;
  isGameChanger?: boolean;
}

export interface OfflineManifest {
  oracleVersion: string;
  oracleCardCount: number;
  oracleByteSize: number;
  oracleUpdatedAt: number;
  combosVersion: string;
  combosCount: number;
  combosByteSize: number;
  combosUpdatedAt: number;
}

export interface OfflineComboPrerequisites {
  easy?: string;
  notable?: string;
}

export interface OfflineComboCard {
  oracleId: string;
  cardName: string;
  quantity: number;
  position: number;
}

export interface OfflineCombo {
  id: string;
  identity: string;
  produces: string[];
  prerequisites: OfflineComboPrerequisites | null;
  description: string | null;
  manaNeeded: string | null;
  popularity: number;
  legalities: Record<string, string>;
  cardCount: number;
  bracket: number | null;
  cards: OfflineComboCard[];
}
