/**
 * Parse the bottom-of-card strip OCR output into a `{ set, number }`
 * pair so the scanner can resolve the *exact* printing via Scryfall
 * (`/cards/{set}/{number}`) rather than falling back to fuzzy-named,
 * which picks an arbitrary printing for cards like Evolving Wilds or
 * basic lands.
 *
 * Modern (post-2008) Magic cards print a single bottom-strip line on
 * the left edge of the lower margin that looks roughly like:
 *
 *     123/280 R MID • EN  ◊  Adam Paquette
 *     0123 • TPR
 *     EOS-001  C
 *     M  RIX  ✦  052/196
 *
 * Layouts vary by year/product, the separator characters get OCR'd into
 * `*`/`.`/`,`/` `, the language code is sometimes missing, and the set
 * code can land before or after the collector number. We only need two
 * tokens — collector number and 3-letter-ish set code — so the parser
 * scans the line for both independently and returns them when both land.
 *
 * Returns null when either field is missing or ambiguous. Caller falls
 * back to the existing title-fuzzy path on null.
 */

/** Tokens that look like a Scryfall collector number. */
const NUMBER_TOKEN_RE = /\b(\d{1,4})(?:\/\d{1,4})?[a-z★]?\b/gi;
/** Tokens that look like a Scryfall set code (3–5 uppercase letters/digits). */
const SET_TOKEN_RE = /\b([A-Z0-9]{3,5})\b/g;

/**
 * Two-letter language tokens commonly printed in the bottom strip —
 * never a set code, so excluded from the set-token candidates.
 */
const LANG_TOKENS = new Set([
  'EN',
  'DE',
  'ES',
  'FR',
  'IT',
  'JA',
  'JP',
  'KO',
  'PT',
  'RU',
  'ZH',
  'ZHS',
  'ZHT',
]);

/**
 * Rarity letters/markers printed on the strip — discarded so they don't
 * masquerade as a set code in the candidate list.
 */
const RARITY_TOKENS = new Set(['C', 'U', 'R', 'M', 'S', 'T', 'P', 'L']);

export interface BottomStripParse {
  set: string;
  number: string;
}

/**
 * Extract `{ set, number }` from a noisy OCR string. Returns null when
 * either field is missing or implausible. Pure / synchronous so it's
 * trivial to unit-test against captured OCR outputs.
 *
 * Strategy:
 *   1. Uppercase + collapse whitespace so token matching is consistent.
 *   2. Pull the *first* number-shaped token that fits Scryfall's
 *      `\d{1,4}(★|letter)?` shape; treat the `123/280` form by keeping
 *      the numerator (Scryfall paths use that).
 *   3. Pull the first 3–5 char alphanumeric token that isn't a known
 *      language/rarity word, isn't all digits, and isn't the collector
 *      number we just took. That's our set code candidate.
 *   4. Return both, lowercased, when present.
 */
export function parseBottomStrip(raw: string): BottomStripParse | null {
  if (!raw) return null;
  const cleaned = raw.toUpperCase().replace(/\s+/g, ' ').trim();
  if (cleaned.length < 3) return null;

  // Collector number: take the first plausible match. Most modern cards
  // print it left-most (`123/280 R MID • EN`); older cards drop the
  // denominator (`0123 • TPR`). Both forms produce the same numerator
  // capture, which is what `/cards/{set}/{number}` expects.
  let collectorNumber: string | null = null;
  NUMBER_TOKEN_RE.lastIndex = 0;
  for (const match of cleaned.matchAll(NUMBER_TOKEN_RE)) {
    const candidate = match[1];
    // Strip leading zeros so Scryfall's path resolves (`/cards/mid/266`
    // not `/cards/mid/00266`). Keep a single zero if the whole token
    // was zeros (defensive — no real card uses `000` but the regex
    // shouldn't crash on it).
    const normalised = candidate.replace(/^0+(?=\d)/, '') || '0';
    if (normalised.length > 0 && normalised.length <= 4) {
      collectorNumber = normalised;
      break;
    }
  }
  if (!collectorNumber) return null;

  // Set code: scan all 3–5 char tokens, discard ones that are
  // language/rarity markers or pure digits (year/copyright) or the
  // collector number itself (the regex can re-match `0123` as a set
  // candidate on the cards that omit the denominator).
  let setCode: string | null = null;
  SET_TOKEN_RE.lastIndex = 0;
  for (const match of cleaned.matchAll(SET_TOKEN_RE)) {
    const candidate = match[1];
    if (LANG_TOKENS.has(candidate)) continue;
    if (RARITY_TOKENS.has(candidate) && candidate.length === 1) continue;
    if (/^\d+$/.test(candidate)) continue;
    if (candidate === collectorNumber) continue;
    // Real set codes contain at least one letter — filters out year/
    // copyright tokens (`2023`) and stray numeric runs. Mixed forms
    // like `30A` are valid Scryfall set codes (the 30th Anniversary
    // promos), so the rule is `≥1 letter`, not `≥2`.
    const letterCount = (candidate.match(/[A-Z]/g) ?? []).length;
    if (letterCount < 1) continue;
    setCode = candidate;
    break;
  }
  if (!setCode) return null;

  return { set: setCode.toLowerCase(), number: collectorNumber };
}
