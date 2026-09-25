interface Props {
  libraryCount: number;
  graveyardCount: number;
  onOpen(): void;
  className: string;
  label: string;
  /** Overrides the button's accessible name — the band's own compact "Damage"
   *  label still needs to announce as "Damage the horde". */
  ariaLabel?: string;
}

/**
 * "Damage the horde" — the button alone, shared by the desktop half
 * (`.horde-table-actions`) and the phone band's bar, so a phone player has
 * the same way to mill the horde's library a desktop player does (E387 PR 5
 * follow-up: the band shipped with no way to win). The sheet it opens is
 * NOT rendered here: it is mounted at board level (see `PlaytestBoard`'s own
 * horde overlays, next to the reveal/end sheets) because `.horde-half`/
 * `.horde-band__field` are not safe containers for a fixed-position overlay
 * — see `horde-containing-block.test.ts`.
 */
export function HordeDamageControl({
  libraryCount,
  graveyardCount,
  onOpen,
  className,
  label,
  ariaLabel,
}: Props) {
  return (
    <button
      type="button"
      className={className}
      aria-label={ariaLabel}
      onClick={onOpen}
      disabled={libraryCount === 0 && graveyardCount === 0}
    >
      {label}
    </button>
  );
}
