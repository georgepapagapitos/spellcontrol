/**
 * A desktop window: wider than a tablet in landscape (1024) with a mouse.
 * There the board is one device-sized table with every seat facing the screen,
 * because nobody sits across a laptop. A touch tablet of any size does not
 * match (`pointer: fine`), so a tablet lying flat between players keeps its
 * rotated seats. Must stay textually identical to the CSS media query in
 * `play-board.css` (`styles/play-board-desktop-table.test.ts` pins it).
 */
export const DESKTOP_TABLE_QUERY = '(min-width: 1025px) and (pointer: fine)';
