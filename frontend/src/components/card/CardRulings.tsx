import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useInRouterContext } from 'react-router-dom';
import { fetchCardRulings, type Ruling } from '@/lib/cards/card-rulings';
import { Button } from '@/components/shared/Button';
import { useAskRules } from '@/lib/ai/use-ask-rules';
import './CardRulings.css';

/** How long a default-open disclosure waits before fetching (see below). */
const RULINGS_SETTLE_MS = 350;

/**
 * Collapsible "Rulings" disclosure for the card preview panel. Rulings are
 * fetched lazily on first expand (not per card swipe) and the date is shown
 * formatted. Render with `key={scryfallId}` so it resets per card.
 *
 * `defaultOpen` starts it expanded and fetches on mount — for the playtest
 * inspector, where a ruling is the reason the card was opened at all, so
 * making the player find a chevron mid-game is the wrong default.
 *
 * With `name`, the open list ends in a door to the rules Q&A seeded with a
 * question about this card, shown only while AI is available. `onLeave` runs
 * first, so the overlay holding the preview closes before the page changes.
 */
export function CardRulings({
  scryfallId,
  defaultOpen = false,
  name,
  onLeave,
}: {
  scryfallId: string;
  defaultOpen?: boolean;
  name?: string;
  onLeave?: () => void;
}) {
  // A preview rendered outside a router has no rules page to open.
  const canLeave = useInRouterContext();
  const [open, setOpen] = useState(defaultOpen);
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'done'>(
    defaultOpen ? 'loading' : 'idle'
  );
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

  // Mount-time fetch for the `defaultOpen` case only; the collapsed default
  // still loads lazily on first expand. The initial state is already
  // 'loading', so nothing here sets state synchronously.
  useEffect(() => {
    if (!defaultOpen) return;
    let alive = true;
    // Wait for the card to settle: the preview mounts this per focused card, so
    // swiping past twenty cards must not fire twenty requests.
    const t = window.setTimeout(() => {
      fetchCardRulings(scryfallId).then(
        (r) => {
          if (!alive) return;
          setRulings(r);
          setState('done');
        },
        () => {
          if (alive) setState('error');
        }
      );
    }, RULINGS_SETTLE_MS);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [defaultOpen, scryfallId]);

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
          strokeWidth={1.8}
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
              Couldn't load rulings.{' '}
              <Button variant="link" onClick={load}>
                Retry
              </Button>
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
          {canLeave && name && <AskAboutCard name={name} onLeave={onLeave} />}
        </div>
      )}
    </div>
  );
}

/** The door to the rules Q&A, seeded with this card; nothing while AI is unavailable. */
function AskAboutCard({ name, onLeave }: { name: string; onLeave?: () => void }) {
  const askRules = useAskRules();
  if (!askRules) return null;
  return (
    <Button
      variant="link"
      className="card-rulings-ask"
      iconEnd={<ChevronRight width={14} height={14} strokeWidth={1.8} />}
      onClick={() => {
        onLeave?.();
        askRules([name]);
      }}
    >
      Ask a rules question about this card
    </Button>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
