// The community half of the voltron rule (golden R11). EDHREC's Voltron theme
// share is the Voltron tag's count over the sum of the page's theme counts.
// Under 4% on a page with 30 or more themed decks the commander is not voltron
// even when its text fits (Gisela, Emrakul and Gishath carry the keywords, not
// the deck). The share only vetoes: it never makes a commander voltron, and a
// thin or missing page leaves the text rule alone.
const VOLTRON_MIN_THEMED_DECKS = 30;
const VOLTRON_MIN_THEME_SHARE = 0.04;

/** The slice of EDHREC's commander-page themes the profile reads (an `EDHRECTheme` fits). */
export interface CommanderProfileTheme {
  name: string;
  slug?: string;
  count: number;
}

export function voltronVetoed(themes: ReadonlyArray<CommanderProfileTheme> | undefined): boolean {
  if (!themes) return false;
  let total = 0;
  let voltron = 0;
  for (const t of themes) {
    if (!(t.count > 0)) continue;
    total += t.count;
    if (t.slug === 'voltron' || t.name.toLowerCase() === 'voltron') voltron += t.count;
  }
  return total >= VOLTRON_MIN_THEMED_DECKS && voltron / total < VOLTRON_MIN_THEME_SHARE;
}
