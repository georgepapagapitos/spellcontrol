import './CalendarLeaf.css';

const MONTH_FMT = new Intl.DateTimeFormat('en-US', { month: 'short' });

/** A tear-off calendar leaf: month over day. Decorative — the caller's text
 *  carries the date for assistive tech. `size="lg"` is Around the table's
 *  anchor; the default fits a Waiting-on-you task. */
export function CalendarLeaf({ at, size }: { at: number; size?: 'lg' }) {
  const d = new Date(at);
  return (
    <span className={`home-leaf${size === 'lg' ? ' home-leaf--lg' : ''}`} aria-hidden="true">
      <span className="home-leaf-month">{MONTH_FMT.format(d).toUpperCase()}</span>
      <span className="home-leaf-day">{d.getDate()}</span>
    </span>
  );
}
