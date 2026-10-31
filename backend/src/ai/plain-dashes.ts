/**
 * The model's dashes, rewritten to the app's punctuation before a reader sees
 * them (E1051).
 *
 * The UI retired the em-dash in 2026-09 (copy-guards EMDASH): the
 * "claim — justification" shape was the most-cited tell that copy read as
 * machine-written. The readings broke the rule on every screen they appear on:
 * 505 saved live-run outputs carried 1,767 em-dashes, about 3.5 a reading, and
 * the prompts' own " - " asides taught the model a spaced hyphen as well. A
 * prompt line only asks; this makes it certain.
 *
 * A comma is the one replacement that reads right without knowing the clause:
 * "fetchlands—Wooded Foothills, Windswept Heath" and "the engine — from X to
 * Y — depends" both become plain commas. Stored rows keep the model's text, so
 * the grounding checks and the eval read what was written; this runs on the
 * way out, which also cleans readings stored before it existed.
 *
 * Untouched: hyphens inside words (Lim-Dûl, Will-o'-the-Wisp), number ranges
 * (2–3, 4 - 5), and the `---MARK---` section labels.
 */
export function plainDashes(text: string): string {
  return (
    text
      // A dash that opens a line has no clause before it to join.
      .replace(/^[ \t]*[—–][ \t]*/gm, '')
      // A spaced hyphen or en-dash between words is a dash too.
      .replace(/(?<=[^\s\d]) [-–] (?=[^\s\d])/g, '—')
      .replace(/[ \t]*—[ \t—]*/g, '\uE000')
      // Beside other punctuation the dash just goes; anywhere else it's a comma.
      .replace(/([,;:])\uE000/g, '$1 ')
      .replace(/\(\uE000/g, '(')
      .replace(/\uE000(?=[.,;:!?)\n]|$)/g, '')
      .replace(/\uE000/g, ', ')
  );
}

/**
 * `plainDashes` over a stream of chunks, with output identical to running it on
 * the whole text. Every rewrite spans a run of dashes and spaces plus one
 * character either side. So a chunk's trailing run is held until the next chunk
 * shows what follows it, and each emitted piece is rewritten with the character
 * before it as context, which no rewrite changes.
 */
export function plainDashStream(emit: (text: string) => void) {
  let held = '';
  let last = '';
  const send = (text: string) => {
    emit(plainDashes(last + text).slice(last.length));
    last = text.slice(-1);
  };
  return {
    push(chunk: string) {
      const text = held + chunk;
      const cut = text.search(/[ \t—–-]*$/);
      held = text.slice(cut);
      if (cut > 0) send(text.slice(0, cut));
    },
    flush() {
      if (held) send(held);
      held = '';
    },
  };
}
