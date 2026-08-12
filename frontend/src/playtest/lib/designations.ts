/** Table designations shown as icon+label badges wherever an opponent's held
 *  designations are surfaced — the presence rail entry and the full board
 *  inspector both read this list, so the icon/label vocabulary can't drift
 *  between the two. Keys match `PublicBoard`'s boolean designation fields
 *  (projection.ts). A leaf module (no component imports) so both surfaces can
 *  depend on it without risking an import cycle between them. */
export const DESIGNATIONS = [
  { key: 'monarch', icon: '👑', label: 'Monarch' },
  { key: 'initiative', icon: '🧭', label: 'Initiative' },
  { key: 'citysBlessing', icon: '🏙️', label: "City's Blessing" },
] as const;
