import { memo, useContext } from 'react';
import type { Page, PocketSize } from '../types';
import { CardSlot } from './CardSlot';
import { CardPreviewContext } from './CardPreviewContext';

interface Props {
  page: Page;
  pageNum: number;
  pageIndex: number;
  pocketSize: PocketSize;
  showImages?: boolean;
  /** What's physically on this page, when the page is its own heading. */
  label?: string;
}

// Memoized: when SectionBlock re-renders for the deferred isPreviewOpen flip,
// pages whose slots/props are unchanged skip re-rendering. CardSlot still
// re-renders via its CardPreviewContext subscription (that's the tooltip-hide),
// but that work is off the open's critical path by the time it runs.
export const PageGrid = memo(function PageGrid({
  page,
  pageNum,
  pageIndex,
  pocketSize,
  showImages,
  label,
}: Props) {
  const gridClass = pocketSize === 4 ? 'grid-4' : pocketSize === 12 ? 'grid-12' : 'grid-9';
  return (
    <div className="page-wrap">
      <PageNum pageNum={pageNum} pageIndex={pageIndex} />
      {/* Above the grid, under the page number, so it reads as THIS page's
          contents — below the grid it visually attaches to the next page's
          heading. Rendered even when empty so every page's grid starts at the
          same height and the row of pages stays on one baseline. */}
      {label !== undefined && (
        <div className="page-label" title={label}>
          {label}
        </div>
      )}
      <div className={`page ${gridClass}`}>
        {page.map((card, i) => (
          <CardSlot key={i} card={card} showImage={showImages} />
        ))}
      </div>
    </div>
  );
});

function PageNum({ pageNum, pageIndex }: { pageNum: number; pageIndex: number }) {
  const ctx = useContext(CardPreviewContext);
  if (!ctx) return <div className="page-num">page {pageNum}</div>;
  return (
    <button
      type="button"
      className="page-num page-num-link"
      onClick={() => ctx.openPages(pageIndex)}
      aria-label={`Browse pages from page ${pageNum}`}
    >
      page {pageNum}
    </button>
  );
}
