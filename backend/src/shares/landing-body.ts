import type { PublicDeckSummary } from '../publications/cache';
import type { PublicResourcePage, PublicResourceSummary } from '../publications/resource-pages';
import { asRecord, asString, type PublicDeck } from './projections';
import { escapeHtmlAttr as esc } from './og';

/**
 * Plain-HTML content for the `/d/:slug` and `/u/:username` landing pages,
 * served inside `<div id="root">` so the HTML a crawler fetches has the page's
 * real text in it. The SPA shell is otherwise an empty root: Search Console
 * (2026-10-08) had 81 pages "Discovered, not indexed" and 12 "Crawled, not
 * indexed" against 221 deck URLs in the sitemap, every one of them served as
 * the same empty body under the same homepage description.
 *
 * React's `createRoot().render` clears the container on its first commit, so
 * this never reaches the rendered app. It is visually hidden (the sr-only clip,
 * inline because no stylesheet has loaded yet) rather than shown: a visible
 * plain-text list would flash and then be replaced by the app's own layout.
 * It is the same content the app renders, so it is not cloaking.
 */
const HIDDEN_STYLE =
  'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0';

/** Decklist groups, in the order a deck page lists them. First match wins. */
const TYPE_GROUPS: ReadonlyArray<[label: string, type: string]> = [
  ['Creatures', 'Creature'],
  ['Planeswalkers', 'Planeswalker'],
  ['Battles', 'Battle'],
  ['Instants', 'Instant'],
  ['Sorceries', 'Sorcery'],
  ['Artifacts', 'Artifact'],
  ['Enchantments', 'Enchantment'],
  ['Lands', 'Land'],
];
const OTHER_GROUP = 'Other';

function cardName(card: unknown): string | undefined {
  return asString(asRecord(card)?.name);
}

function groupOf(card: unknown): string {
  // A double-faced card's front face decides, same as its slot in the app.
  const typeLine = (asString(asRecord(card)?.type_line) ?? '').split('//')[0];
  return TYPE_GROUPS.find(([, t]) => typeLine.includes(t))?.[0] ?? OTHER_GROUP;
}

function wrap(inner: string): string {
  return `<main style="${HIDDEN_STYLE}">${inner}</main>`;
}

export function buildDeckLandingBody(page: { deck: PublicDeck }): string {
  const { deck } = page;
  const owner = deck.ownerDisplayName ?? deck.ownerUsername;
  const commanders = [deck.commander, deck.partnerCommander]
    .map(cardName)
    .filter((n): n is string => !!n);

  // One slot per copy: count by name within each group, keeping first-seen order.
  const groups = new Map<string, Map<string, number>>();
  for (const { card } of deck.cards) {
    const name = cardName(card);
    if (!name) continue;
    const group = groupOf(card);
    const counts = groups.get(group) ?? new Map<string, number>();
    counts.set(name, (counts.get(name) ?? 0) + 1);
    groups.set(group, counts);
  }

  const parts = [
    `<h1>${esc(deck.name)}</h1>`,
    `<p>A ${esc(deck.format)} deck${
      commanders.length ? ` led by ${esc(commanders.join(' and '))}` : ''
    }, by <a href="/u/${esc(deck.ownerUsername)}">${esc(owner)}</a>.</p>`,
  ];
  if (deck.primer) parts.push(`<p>${esc(deck.primer)}</p>`);
  if (commanders.length) {
    parts.push(
      `<h2>Commander</h2><ul>${commanders.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`
    );
  }
  for (const label of [...TYPE_GROUPS.map(([l]) => l), OTHER_GROUP]) {
    const counts = groups.get(label);
    if (!counts) continue;
    let total = 0;
    const items: string[] = [];
    for (const [name, n] of counts) {
      total += n;
      items.push(`<li>${n} ${esc(name)}</li>`);
    }
    parts.push(`<h2>${label} (${total})</h2><ul>${items.join('')}</ul>`);
  }
  return wrap(parts.join(''));
}

export function buildProfileLandingBody(profile: {
  username: string;
  displayName: string | null;
  bio: string | null;
  decks: PublicDeckSummary[];
  /** Published binders and lists (E401); absent reads as none. */
  resources?: PublicResourceSummary[];
}): string {
  const parts = [`<h1>${esc(profile.displayName ?? profile.username)}</h1>`];
  if (profile.bio) parts.push(`<p>${esc(profile.bio)}</p>`);
  if (profile.decks.length) {
    const items = profile.decks.map(
      (d) =>
        `<li><a href="/d/${esc(d.slug)}">${esc(d.name)}</a>, ${esc(d.format)} deck${
          d.commanderName ? ` led by ${esc(d.commanderName)}` : ''
        }</li>`
    );
    parts.push(`<h2>Public decks</h2><ul>${items.join('')}</ul>`);
  }
  for (const [kind, heading, path] of [
    ['binder', 'Public binders', '/b/'],
    ['list', 'Public lists', '/l/'],
  ] as const) {
    const rows = (profile.resources ?? []).filter((r) => r.kind === kind);
    if (!rows.length) continue;
    const items = rows.map((r) => `<li><a href="${path}${esc(r.slug)}">${esc(r.name)}</a></li>`);
    parts.push(`<h2>${heading}</h2><ul>${items.join('')}</ul>`);
  }
  return wrap(parts.join(''));
}

/** A body is capped so one huge binder cannot make the landing HTML enormous. */
const RESOURCE_BODY_MAX_CARDS = 500;

export function buildResourceLandingBody(page: PublicResourcePage): string {
  const { data } = page;
  const owner = data.ownerDisplayName ?? data.ownerUsername;
  const parts = [
    `<h1>${esc(data.name)}</h1>`,
    `<p>A ${page.kind === 'binder' ? 'binder' : 'card list'} by <a href="/u/${esc(
      data.ownerUsername
    )}">${esc(owner)}</a>.</p>`,
  ];
  let budget = RESOURCE_BODY_MAX_CARDS;
  if (page.kind === 'binder') {
    for (const section of page.data.sections) {
      if (budget <= 0) break;
      const counts = new Map<string, number>();
      for (const card of section.cards.slice(0, budget)) {
        counts.set(card.name, (counts.get(card.name) ?? 0) + 1);
      }
      budget -= section.cards.slice(0, budget).length;
      const items = [...counts].map(([name, n]) => `<li>${n} ${esc(name)}</li>`);
      parts.push(`<h2>${esc(section.label)}</h2><ul>${items.join('')}</ul>`);
    }
  } else {
    const items = page.data.entries
      .slice(0, budget)
      .map((e) => `<li>${e.quantity} ${esc(e.name)}</li>`);
    parts.push(`<ul>${items.join('')}</ul>`);
  }
  return wrap(parts.join(''));
}
