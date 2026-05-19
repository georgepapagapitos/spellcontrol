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
}: Props) {
  const gridClass = pocketSize === 4 ? 'grid-4' : pocketSize === 12 ? 'grid-12' : 'grid-9';
  return (
    <div className="page-wrap">
      <PageNum pageNum={pageNum} pageIndex={pageIndex} />
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
