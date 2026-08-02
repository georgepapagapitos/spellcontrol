/**
 * Seat-facing indicator arrow. Its own module so the board, the seat menu and
 * the layout editor can all use it without importing each other (the split
 * otherwise creates GameBoard <-> SeatMenu / LayoutEditor import cycles).
 */
/** Up-arrow rotated by `rot` — shows which way a seat's panel will read. */
export function FacingArrow({ rot }: { rot: number }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
      style={{ transform: `rotate(${rot}deg)` }}
    >
      <path
        d="M9 3.5 L9 14 M9 3.5 L5.5 7 M9 3.5 L12.5 7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
