import { GAME_CHANGERS_AS_OF, HARDCODED_GAME_CHANGERS } from '@spellcontrol/deck-metrics';
import { escapeHtmlAttr as esc, ORIGIN, type ShareLandingMeta } from './shares/og';

/**
 * Head tags and crawler-readable body for the public bracket checker
 * (`/bracket`, E1090). The page itself is the SPA, so a crawler that does not
 * run JS would otherwise fetch the homepage description over an empty root. The
 * Game Changers list and its as-of date come from the same package constant the
 * page and the estimator read, so the three cannot disagree.
 */
export const BRACKET_PATH = '/bracket';

export function bracketLandingMeta(): ShareLandingMeta {
  return {
    title: 'Commander bracket checker: paste a decklist, no sign-up',
    description:
      'Paste a Commander decklist and see which bracket it reads as, with the Game Changers, combos and rules behind the estimate. Free, no account.',
    url: `${ORIGIN}${BRACKET_PATH}`,
    indexable: true,
    body: bracketLandingBody(),
  };
}

export function bracketLandingBody(): string {
  const names = [...HARDCODED_GAME_CHANGERS].sort((a, b) => a.localeCompare(b));
  const asOf = new Date(`${GAME_CHANGERS_AS_OF}T12:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
  return (
    `<main style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0">` +
    `<h1>Commander bracket checker</h1>` +
    `<p>Paste a Commander decklist to see which of the five brackets it reads as, and the cards and rules behind the estimate. No account needed.</p>` +
    `<h2>Game Changers</h2>` +
    `<p>${names.length} cards. Last checked against the Rules Committee's list on ${esc(asOf)}.</p>` +
    `<ul>${names.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` +
    `<p><a href="/guides/bracket-estimator.html">How the estimate is made and checked</a></p>` +
    `</main>`
  );
}
