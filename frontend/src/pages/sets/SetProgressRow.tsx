import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { releaseYear, type SetProgress } from '@/lib/cards/set-completion';
import { MeterBar } from '@/components/shared/MeterBar';
import { Button } from '@/components/shared/Button';

/**
 * Completion rows for the Sets hub and the Secret Lair page: one row per set
 * or drop, plus the capped drop list both drop searches render. Styles live
 * in SetsPage.css (this module only renders inside SetsPage).
 */

/** Hub link for a progress row — drop rows deep-link into the SLD checklist. */
function setRowLink(s: SetProgress): string {
  const base = `/collection/sets/${s.code.toLowerCase()}`;
  return s.drop ? `${base}?drop=${encodeURIComponent(s.drop)}` : base;
}

/** One completion row — a hub set, or a Secret Lair drop inside the SLD page. */
export function SetProgressRow({ s }: { s: SetProgress }) {
  const complete = s.pct === 100;
  return (
    <li>
      <Link
        to={setRowLink(s)}
        className={`sets-row${complete ? ' is-complete' : ''}`}
        aria-label={
          s.total > 0
            ? `${s.name}, ${s.owned} of ${s.total} cards, ${s.pct}% complete`
            : `${s.name}, ${s.owned} cards owned`
        }
      >
        {s.iconSvgUri ? (
          <img src={s.iconSvgUri} alt="" aria-hidden className="sets-row-icon" />
        ) : (
          <span className="sets-row-icon sets-row-icon-ph" aria-hidden />
        )}
        <span className="sets-row-body">
          <span className="sets-row-name">{s.name}</span>
          <span className="sets-row-meta">
            <span className="sets-row-code">{s.code}</span>
            {releaseYear(s.releasedAt) && <span>{releaseYear(s.releasedAt)}</span>}
            <span>
              {s.total > 0
                ? `${s.owned}/${s.total} cards`
                : `${s.owned} ${s.owned === 1 ? 'card' : 'cards'}`}
            </span>
          </span>
          {s.total > 0 && (
            <MeterBar
              value={s.owned}
              max={s.total}
              minPct={1.5}
              color={complete ? 'var(--brand-seal-gold)' : undefined}
              className="sets-row-bar"
            />
          )}
        </span>
        <span className={`sets-row-pct${complete ? ' is-complete' : ''}`}>
          {complete && <CheckCircle2 width={16} height={16} aria-hidden strokeWidth={2} />}
          {s.total > 0 ? `${s.pct}%` : '—'}
        </span>
      </Link>
    </li>
  );
}

const DROP_PREVIEW = 6;

/**
 * Secret Lair drop rows, capped at {@link DROP_PREVIEW} with a reveal-all
 * button. The reveal belongs to the `query` it was pressed for, so a new
 * search starts capped again. Focus moves to the first revealed row, since
 * the button that held it disappears.
 */
export function DropRowList({ rows, query }: { rows: SetProgress[]; query: string }) {
  const [revealedFor, setRevealedFor] = useState<string | null>(null);
  const all = revealedFor === query;
  const listRef = useRef<HTMLUListElement>(null);
  const focusPending = useRef(false);
  useEffect(() => {
    if (all && focusPending.current) {
      focusPending.current = false;
      listRef.current?.querySelectorAll('a')[DROP_PREVIEW]?.focus();
    }
  }, [all]);
  const visible = all ? rows : rows.slice(0, DROP_PREVIEW);
  return (
    <>
      <ul ref={listRef} className="list-stack sets-list">
        {visible.map((s) => (
          <SetProgressRow key={s.drop} s={s} />
        ))}
      </ul>
      {!all && rows.length > DROP_PREVIEW && (
        <Button
          onClick={() => {
            focusPending.current = true;
            setRevealedFor(query);
          }}
        >
          Show all {rows.length} drops
        </Button>
      )}
    </>
  );
}
