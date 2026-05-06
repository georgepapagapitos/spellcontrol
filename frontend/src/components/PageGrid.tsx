import type { Page, PocketSize } from '../types';
import { CardSlot } from './CardSlot';

interface Props {
  page: Page;
  pageNum: number;
  pocketSize: PocketSize;
}

export function PageGrid({ page, pageNum, pocketSize }: Props) {
  if (pocketSize === 18) {
    return <Page18 page={page} pageNum={pageNum} />;
  }

  const gridClass = pocketSize === 4 ? 'grid-4' : 'grid-9';
  return (
    <div className="page-wrap">
      <div className="page-num">p{pageNum}</div>
      <div className={`page ${gridClass}`}>
        {page.map((card, i) => (
          <CardSlot key={i} card={card} />
        ))}
      </div>
    </div>
  );
}

function Page18({ page, pageNum }: { page: Page; pageNum: number }) {
  const front = page.slice(0, 9);
  const back = page.slice(9, 18);
  while (front.length < 9) front.push(null);
  while (back.length < 9) back.push(null);

  return (
    <div className="page-wrap">
      <div className="page-num">page {pageNum}</div>
      <div className="page-18">
        <Side label="front" cards={front} />
        <Side label="back" cards={back} />
      </div>
    </div>
  );
}

function Side({ label, cards }: { label: string; cards: Page }) {
  return (
    <div className="page-18-side">
      <div className="page-18-side-label">{label}</div>
      <div className="grid-18-half">
        {cards.map((card, i) => (
          <CardSlot key={i} card={card} />
        ))}
      </div>
    </div>
  );
}
