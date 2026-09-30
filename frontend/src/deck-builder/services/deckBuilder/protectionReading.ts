// E555: what a card's text says about protecting something, read one way for
// everyone. A zero-import leaf (text in, boolean out) so the tagger's
// `isProtectionPiece` (which the build report's `protectionCount` and every
// eviction phase read), the generator's E532 survival rule
// (deckGeneration/protectionPicks.ts) and the deck objective
// (deckObjective/factsReading.ts) share ONE reading instead of copies that
// drifted: Snakeskin Veil ("Put a +1/+1 counter on target creature you
// control. It gains hexproof until end of turn.") names its target in one
// sentence and the keyword in the next, so a per-sentence reading and the
// tagger's single-sentence regex both missed it, and the report counted no
// protection in a deck that held it.

const PROTECTION_WORDS =
  /\b(hexproof|shroud|indestructible|protection from|phases? out|can't be the target|can't be countered|ward)\b/i;

/**
 * What a protection clause is FOR: another permanent, the player, a spell.
 * "Equipped creature", "creatures you control", "target creature", "you gain
 * protection", "all permanents you control phase out", "spells you control
 * can't be countered". A clause about the card itself ("~ phases out",
 * "this creature has hexproof", a bare keyword) protects only that card.
 */
const PROTECTS_OTHER =
  /\b(equipped|enchanted|target|other|another|each|all|any number of)\b[^.]*?\b(creatures?|permanents?|commanders?|spells?|player)\b|\b(creatures?|permanents?|spells?) you control\b|\byou (gain|have|get)\b[^.]*?\b(protection|hexproof|shroud)\b|\byour commanders?\b/i;

/**
 * What keeps a permanent on the battlefield (E532's survival rule): a
 * counterspell that protects a SPELL does not keep a commander alive.
 */
const KEEPS_PERMANENT = /\b(hexproof|shroud|indestructible|protection from)\b|\bphases? out\b/i;

/** A sentence that refers back to the one before it ("It gains hexproof"). */
const PRONOUN_LEAD = /^(it|they|those creatures|that creature|each of them)\b/i;

/** "It gains hexproof": a pronoun granting a keeping word. */
const GRANT_TO_PRONOUN =
  /^(?:it|they|those creatures|that creature|each of them)\s+(?:also\s+)?gains?\b[^.]*?\b(hexproof|shroud|indestructible|protection from)\b/i;

const TARGET_PERMANENT = /\btarget\b[^.]*?\b(creatures?|permanents?)\b/i;

const withoutReminder = (text: string): string => text.replace(/\([^)]*\)/g, '');

/** Rules text without reminder text, split into sentences. */
function sentencesOf(text: string): string[] {
  return withoutReminder(text)
    .split(/(?<=[.\n])\s*/)
    .filter(Boolean);
}

/**
 * The sentences that carry a protection word. A sentence that opens with a
 * pronoun is read together with the one before it, which is where its subject
 * is named.
 */
export function protectionSentencesOf(text: string): string[] {
  const all = sentencesOf(text);
  const out: string[] = [];
  all.forEach((sentence, i) => {
    if (!PROTECTION_WORDS.test(sentence)) return;
    out.push(i > 0 && PRONOUN_LEAD.test(sentence.trim()) ? `${all[i - 1]} ${sentence}` : sentence);
  });
  return out;
}

/** Whether one protection sentence protects something besides its own card. */
export function protectsOther(sentence: string): boolean {
  return PROTECTS_OTHER.test(sentence);
}

/** True when the text's protection protects something other than its own card. */
export function protectsOthersText(text: string): boolean {
  return protectionSentencesOf(text).some(protectsOther);
}

/** Protection words that only ever protect the card itself (Kaito Shizuki). */
export function protectsOnlyItselfText(text: string): boolean {
  const sentences = protectionSentencesOf(text);
  return sentences.length > 0 && !sentences.some(protectsOther);
}

/** The text names a word that keeps a permanent on the battlefield (reminder text aside). */
export function keepsPermanentText(text: string): boolean {
  return KEEPS_PERMANENT.test(withoutReminder(text));
}

/**
 * A grant that names its target in one sentence and the keyword in the next:
 * "Put a +1/+1 counter on target creature you control. It gains hexproof until
 * end of turn." (Snakeskin Veil, Gaea's Gift, Saved by the Shell). The
 * tagger's single-sentence evidence cannot see it.
 */
export function grantsToTargetText(text: string): boolean {
  const all = sentencesOf(text);
  return all.some(
    (sentence, i) =>
      i > 0 &&
      PRONOUN_LEAD.test(sentence.trim()) &&
      GRANT_TO_PRONOUN.test(sentence.trim()) &&
      TARGET_PERMANENT.test(all[i - 1])
  );
}
