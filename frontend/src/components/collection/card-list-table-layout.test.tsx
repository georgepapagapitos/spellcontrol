// @vitest-environment happy-dom
/**
 * The collection grid mounts late whenever the table first rendered an empty
 * state: a "Proxies only" filter that matched nothing, then a 2+ character
 * query that brought in the Add-cards hand-off tile. The width observer used
 * to attach only when `view` changed, so the late grid never got measured: it
 * stayed at the 4-column fallback with a 250px row estimate while the tile
 * rendered at full card height, overrunning the page footer. This drives the
 * real hook and the real virtualizer through that sequence.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { ScrollContainerContext } from '@/lib/util/scroll-container';
import { GRID_GAP_PX, zoomCols, zoomTier } from '@/lib/util/grid-zoom';
import { useTableLayout } from './card-list-table-layout';

const WIDTH = 1200;
const ZOOM = 0;
const NO_COLLAPSED = new Set<string>();

const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset.testWidth ? Number(this.dataset.testWidth) : 0;
    },
  });
});
afterAll(() => {
  if (clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth);
});

function Harness({ gridMounted }: { gridMounted: boolean }) {
  const { gridContainerRef, gridVirtualizer, gridCols } = useTableLayout({
    view: 'grid',
    phone: false,
    groupKey: 'none',
    displayRowCount: 0,
    showScryfall: gridMounted,
    sortedCount: 0,
    sectionHeaders: null,
    collapsedKeys: NO_COLLAPSED,
    effectiveZoom: ZOOM,
    gridCaptionLines: 0,
    resetKey: String(gridMounted),
  });
  return gridMounted ? (
    <div
      ref={gridContainerRef}
      data-test-width={WIDTH}
      data-testid="grid"
      data-cols={gridCols}
      data-total={gridVirtualizer.getTotalSize()}
    />
  ) : (
    <p>No matches.</p>
  );
}

describe('useTableLayout grid that mounts after an empty state', () => {
  it('measures the late grid and sizes the hand-off row at full card height', async () => {
    const scrollEl = document.createElement('div');
    const tree = (gridMounted: boolean) => (
      <ScrollContainerContext.Provider value={scrollEl}>
        <Harness gridMounted={gridMounted} />
      </ScrollContainerContext.Provider>
    );
    const { rerender, getByTestId } = render(tree(false));
    rerender(tree(true));

    const cols = zoomCols(ZOOM, zoomTier(WIDTH), WIDTH);
    const colWidth = (WIDTH - GRID_GAP_PX * (cols - 1)) / cols;
    const rowHeight = colWidth * (680 / 488) + GRID_GAP_PX;
    await waitFor(() => {
      const grid = getByTestId('grid');
      expect(Number(grid.dataset.cols)).toBe(cols);
      expect(Number(grid.dataset.total)).toBeCloseTo(rowHeight, 0);
    });
  });
});
