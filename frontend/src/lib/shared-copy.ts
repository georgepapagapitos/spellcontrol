/**
 * Facts stated on more than one surface (STYLE_GUIDE voice rule 18): one
 * string each, so the wording can't drift between screens.
 */

/** A proxy copy: the card editor's flag, the binder bulk toggle, the importer. */
export const PROXY_HINT = 'Counts as owned, with no market value.';

/**
 * The opt-in blurb on an AI feature: what it does, what it sends, then the
 * privacy facts every AI surface states the same way.
 */
export function aiConsentBlurb(purpose: string, sends: string): string {
  return `${purpose} Turning this on sends ${sends} to Anthropic. Nothing is sent until you press an AI button. Your collection is never sent. Turn it off any time in Settings.`;
}
