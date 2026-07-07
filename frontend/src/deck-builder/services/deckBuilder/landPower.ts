/**
 * Intrinsic land-quality score — a merit rating for a land read ONLY from its
 * Scryfall fields (produced mana, oracle text, type line), with ZERO dependence
 * on EDHREC popularity or the tagger snapshot.
 *
 * Why this exists: candidate-pool membership and ranking for lands is otherwise
 * EDHREC-first, so a genuinely strong *new* dual (printed too recently for
 * EDHREC's sample, and absent from the periodically-refreshed tagger snapshot)
 * never competes on merit. This scores a card printed yesterday the same way it
 * scores a staple, so newness stops being a disqualifier. It's `landSanityFindings`
 * (which reasons rule-by-rule about *bad* lands) inverted into a positive rating.
 *
 * The score is a 0–100 heuristic; absolute values are arbitrary, only the
 * ORDERING matters (untapped multi-color fixer > tapped dual > basic > off-color
 * junk). Consumers use it as a bounded re-rank signal, never as the sole gate.
 */
import type { ScryfallCard } from '@/deck-builder/types';
import { producedManaColors } from '@/lib/mana-sources';
import { fetchableBasicColors, fetchedBasicRequirement } from './manabaseMath';
import { isMdfcLand, isChannelLand } from '../scryfall/client';

const COLOR_KEYS = ['W', 'U', 'B', 'R', 'G'] as const;

/** Whether the card is a land at all (front face) — MDFC spell/lands count. */
function isLandCard(card: ScryfallCard): boolean {
  const front = (card.type_line || card.card_faces?.[0]?.type_line || '').toLowerCase();
  const back = (card.card_faces?.[1]?.type_line || '').toLowerCase();
  return front.includes('land') || back.includes('land');
}

/** Basic lands are the manabase floor — Layer B swaps them OUT for better lands. */
function isBasicLand(card: ScryfallCard): boolean {
  return /\bbasic\b/.test((card.type_line || '').toLowerCase());
}

/**
 * Enters-tapped classification from oracle text (NOT the tagger tag, which lags
 * for new cards). "enters tapped" unconditionally is a real downside; a
 * conditional tapped clause (shock/check/fast/pain lands: "unless…", "you may
 * pay…", "if you don't…") is untapped in practice most games.
 * ponytail: regex heuristic; ceiling = exotic tapped wordings. Upgrade path is a
 * curated exception set if a specific card misreads.
 */
function tappedKind(card: ScryfallCard): 'untapped' | 'conditional' | 'tapped' {
  const ot = (card.oracle_text ?? card.card_faces?.[0]?.oracle_text ?? '').toLowerCase();
  if (!/enters (the battlefield )?tapped/.test(ot)) return 'untapped';
  if (/unless|you may pay|if you don'?t|pay \d+ life|as .* enters/.test(ot)) return 'conditional';
  return 'tapped';
}

/** A real typed dual/tri land ("Land — Island Swamp") — fetchable + untapped-ish. */
function basicTypeCount(card: ScryfallCard): number {
  const tl = (card.type_line || '').toLowerCase();
  return COLOR_KEYS.filter((c) => {
    const word = { W: 'plains', U: 'island', B: 'swamp', R: 'mountain', G: 'forest' }[c];
    return tl.includes(word);
  }).length;
}

/** Non-mana upside: an activated ability or a keyworded spell-like effect. */
function hasUpside(card: ScryfallCard): boolean {
  const ot = (card.oracle_text ?? card.card_faces?.[0]?.oracle_text ?? '').toLowerCase();
  if (isChannelLand(card) || /\bchannel\b/.test(ot)) return true;
  // An activated ability whose cost isn't purely tapping for mana.
  if (/\{t\}[^:]*:(?!\s*add\b)/.test(ot)) return true;
  // Damage-dealing is upside only when it hits something else — "damage to you"
  // is the painland downside, handled by painPenalty, not a reason to run it.
  return /draw a card|destroy target|deals? \d+ damage(?! to you)|create a .* token|scry/.test(ot);
}

/**
 * Recurring self-cost of a fixer that the color-count credit ignores: painlands
 * (City of Brass, Grand Coliseum, Yavimaya Coast — "deals N damage to you" when
 * tapped) and pay-life rainbow lands (Mana Confluence — "pay N life: add …").
 * Without this, a rainbow land clamped to a 2-color deck scores like a clean
 * untapped dual it's strictly worse than — it out-selected Darkslick Shores on
 * Yuriko in the E116 A/B. In a 4–5 color deck the higher color count still wins;
 * this only rebalances the low-color case where the extra colors go unused.
 */
function painPenalty(card: ScryfallCard): number {
  const ot = (card.oracle_text ?? card.card_faces?.[0]?.oracle_text ?? '').toLowerCase();
  if (/deals? \d+ damage to you/.test(ot)) return 12;
  if (/pay \d+ life[,.:]?\s*(?:and [^:]*)?add\b/.test(ot)) return 10;
  return 0;
}

/**
 * Merit score in [0, 100] for a land, given the deck's color identity. Non-lands
 * score 0. Higher = more worth running than a basic; new-but-strong lands score
 * in the same band as established staples because nothing here reads popularity.
 */
export function landPowerScore(card: ScryfallCard, identity: ReadonlySet<string>): number {
  if (!isLandCard(card)) return 0;

  // Colors this land effectively supplies, clamped to the deck's identity: what
  // it taps for, plus (for fetch lands producing nothing themselves) what it can
  // find. Off-identity production is dropped — an off-color land isn't fixing.
  const produced = producedManaColors(card, identity);
  const fix = new Set(produced.filter((c) => identity.has(c)));
  for (const c of fetchableBasicColors(card, identity)) fix.add(c);
  const nColors = fix.size;
  const producesColorless = produced.includes('C');

  const tapped = tappedKind(card);
  let score = 0;

  if (nColors >= 2) {
    // Multi-color fixing is the headline value — scales with colors covered.
    score += Math.min(nColors, 5) * 18; // 2c=36 … 5c=90
    if (tapped === 'untapped') score += 15;
    else if (tapped === 'conditional') score += 8;
    if (basicTypeCount(card) >= 2) score += 8; // typed dual → fetchable
  } else if (nColors === 1) {
    // Single-color source — basic-tier; untapped edges it above a tapland.
    score += 12;
    if (tapped === 'untapped') score += 8;
  } else if (producesColorless) {
    // Colorless utility land — no fixing, but not off-color junk.
    score += 5;
  }

  if (fetchedBasicRequirement(card)) score += 12; // deck-thinning fetch
  if (isMdfcLand(card)) score += 12; // near-free land slot (spell side)
  if (hasUpside(card)) score += 10; // channel / activated ability / effect
  score -= painPenalty(card); // painland / pay-life self-cost the color count ignores

  // A basic land is the explicit floor: cap it below any real nonbasic so the
  // upgrade engine always prefers a better land over an extra basic.
  if (isBasicLand(card)) return Math.min(score, 20);

  return Math.min(100, score);
}
