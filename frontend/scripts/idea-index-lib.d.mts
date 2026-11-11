export interface RawTag {
  name: string;
  url: string;
  sanitized?: string;
  num_decks: number;
}
export interface IdeaRow {
  slug: string;
  name: string;
  kind: 'typal' | 'playstyle';
  type?: string;
  decks: number;
  commanders: number;
  card: string;
}
export const MIN_DECKS: number;
export const MIN_COMMANDERS: number;
export const DROPPED_SLUGS: Set<string>;
export const ALIAS_TERMS: Record<string, string[]>;
export function singularForms(word: string): string[];
export function creatureTypeOf(name: string, creatureTypes: string[]): string | null;
export function slugOfUrl(url: string): string;
export function keepTag(t: { slug: string; decks: number; commanders: number | null }): boolean;
export function aliasesFor(slugs: string[]): Record<string, string[]>;
export function buildIdeas(
  tags: RawTag[],
  pages: Map<string, { commanders: number; top: string | null } | null>,
  creatureTypes: string[]
): { ideas: IdeaRow[]; dropped: number };
