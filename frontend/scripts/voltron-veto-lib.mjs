// Shared by refresh-voltron-veto.mjs and its tests: the EDHREC half of the Voltron rule
// (commander-profile.golden.md R11) and the cheap text screen that picks which commanders to
// ask EDHREC about. commanderProfile.ts holds the rule itself; a test pins this copy to it.

export const VOLTRON_MIN_THEMED_DECKS = 30;
export const VOLTRON_MIN_THEME_SHARE = 0.04;

/** True when the page lists enough themed decks and Voltron holds under 4% of them. */
export function isVoltronVetoed(themes) {
  if (!themes) return false;
  let total = 0;
  let voltron = 0;
  for (const t of themes) {
    if (!(t.count > 0)) continue;
    total += t.count;
    if (t.slug === 'voltron' || String(t.name ?? t.value ?? '').toLowerCase() === 'voltron') {
      voltron += t.count;
    }
  }
  return total >= VOLTRON_MIN_THEMED_DECKS && voltron / total < VOLTRON_MIN_THEME_SHARE;
}

// A superset of every commander the text rule in commanderProfile.ts can read as voltron:
// a front face that is a creature and carries an evasion or protection keyword, double strike,
// gear or a "commander you control" clause, a self-growth counter or pump, or a written-out
// evasion. Wider than the rule on purpose: a miss here would leave a vetoable commander out of
// the snapshot, while an extra page costs one polite request.
const SCREEN =
  /\b(?:attach|equipped|enchanted|aura|equipment|commanders? you control|can't be blocked|hexproof|shroud|protection from|ward|indestructible|double strike|first strike|trample|flying|menace|deathtouch)\b|\+1\/\+1 counter|gets \+/i;

export function isVoltronCandidate(card) {
  const front = String(card.type_line ?? card.typeLine ?? '').split(' // ')[0];
  if (!/creature/i.test(front)) return false;
  const text = [card.oracle_text, ...(card.card_faces ?? []).map((f) => f.oracle_text)]
    .filter(Boolean)
    .join('\n');
  const kws = (card.keywords ?? []).join(' ');
  return SCREEN.test(`${text}\n${kws}`);
}

/** The name the snapshot is keyed by: front face, lowercased. */
export function snapshotKey(name) {
  return String(name).split(' // ')[0].toLowerCase();
}

/** EDHREC's commander page slug (mirrors formatCommanderNameForUrl). */
export function edhrecSlug(name) {
  return String(name)
    .split(' // ')[0]
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[',]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}
