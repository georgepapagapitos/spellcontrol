export const VOLTRON_MIN_THEMED_DECKS: number;
export const VOLTRON_MIN_THEME_SHARE: number;
export function isVoltronVetoed(
  themes: ReadonlyArray<{ name?: string; value?: string; slug?: string; count: number }> | undefined
): boolean;
export function isVoltronCandidate(card: {
  type_line?: string;
  typeLine?: string;
  oracle_text?: string;
  card_faces?: Array<{ oracle_text?: string }>;
  keywords?: string[];
}): boolean;
export function snapshotKey(name: string): string;
export function edhrecSlug(name: string): string;
