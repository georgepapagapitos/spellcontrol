/**
 * How long a deck name may be, wherever one is typed (board E342).
 *
 * 80 characters is what Moxfield allows, and it is the same number the server
 * clamps display metadata to (`DECK_NAME_MAX` in
 * `backend/src/shares/projections.ts`), so a name that reaches a title, an
 * `og:title` or a profile tile can't be longer than one someone could type.
 * The two constants are paired the way `DISPLAY_NAME_MAX` already is across
 * `components/ProfileEditor.tsx` and `backend/src/auth.ts`.
 *
 * The cap belongs on every input a deck can be named from — the editor's
 * rename field and the import dialog's per-file name — not on the stored
 * value: truncating a name someone already saved is a worse trade than
 * truncating how it is displayed.
 */
export const DECK_NAME_MAX = 80;
