/**
 * Shapes returned by /api/offline/* — kept duplicated from the backend's
 * `offline/types.ts` so the frontend doesn't import backend code (mirrors the
 * pattern in `types/combos.ts`).
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
  rarity?: string;
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
  prerequisites: { easy?: string; notable?: string } | null;
  description: string | null;
  manaNeeded: string | null;
  popularity: number;
  legalities: Record<string, string>;
  cardCount: number;
  bracket: number | null;
  cards: OfflineComboCard[];
}
