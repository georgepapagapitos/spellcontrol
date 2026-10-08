/**
 * The width of the trade workspace at which the review docks beside the grid
 * instead of sitting in a tray and a sheet.
 *
 * Two readers must agree on it: the stylesheet's `@container trade-workspace`
 * query (which lays the two columns out) and the component's `useElementWidth`
 * check (which decides whether to mount the dock or the tray). It is a
 * CONTAINER width, not a viewport one: the hub's own chrome decides how much of
 * the window the workspace gets. `workspace-layout.test.ts` reads
 * TradeWorkspace.css and fails if the two numbers drift.
 *
 * 880 = the 380px dock, a gutter, and room for a grid of four or five tiles.
 */
export const DOCK_MIN_WIDTH = 880;
