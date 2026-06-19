import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { fetchCardRulings, type Ruling } from '../lib/card-rulings';
import './CardRulings.css';

/**
 * Collapsible "Rulings" disclosure for the card preview panel. Rulings are
 * fetched lazily on first expand (not per card swipe) and the date is shown
 * formatted. Render with `key={scryfallId}` so it resets per card.
 */
export function CardRulings({ scryfallId }: { scryfallId: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'done'>('idle');
  const [rulings, setRulings] = useState<Ruling[]>([]);

  const load = () => {
    setState('loading');
    fetchCardRulings(scryfallId).then(
      (r) => {
        setRulings(r);
        setState('done');
      },
      () => setState('error')
    );
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && (state === 'idle' || state === 'error')) load();
  };

  return (
    <div className="card-rulings">
      <button type="button" className="card-rulings-toggle" aria-expanded={open} onClick={toggle}>
        <ChevronDown
          width={14}
          height={14}
          strokeWidth={2.2}
          aria-hidden
          className={`card-rulings-chevron${open ? ' is-open' : ''}`}
        />
        Rulings
        {state === 'done' && rulings.length > 0 && (
          <span className="card-rulings-count">{rulings.length}</span>
        )}
      </button>

      {open && (
        <div className="card-rulings-body">
          {state === 'loading' && (
            <p className="card-rulings-status" aria-busy="true">
              Loading rulings…
            </p>
          )}
          {state === 'error' && (
            <p className="card-rulings-status">
              Couldn’t load rulings.{' '}
              <button type="button" className="card-rulings-retry" onClick={load}>
                Retry
              </button>
            </p>
          )}
          {state === 'done' && rulings.length === 0 && (
            <p className="card-rulings-status">No official rulings for this card.</p>
          )}
          {state === 'done' &&
            rulings.map((r, i) => (
              <div key={i} className="card-rulings-item">
                <p className="card-rulings-comment">{r.comment}</p>
                <p className="card-rulings-meta">{formatDate(r.published_at)}</p>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
