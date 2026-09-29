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
  return `${purpose} Turning this on sends ${sends} to Anthropic. Nothing is sent until you press an AI button. Your collection is never sent. Turn it off any time in You › AI.`;
}

/** Changes kept on this device while offline: the sync toast and the sync pill. */
export function offlineSavedLine(count: number): string {
  const what = count === 1 ? '1 change' : `${count.toLocaleString()} changes`;
  return `${what} saved here until you reconnect.`;
}

/** The two ways to play, on the Play page's doors and the game-night venue picker. */
export const TABLE_PLAY_HINT = 'One device for every seat.';
export const ONLINE_PLAY_HINT = 'Everyone on their own device, with a join code.';
