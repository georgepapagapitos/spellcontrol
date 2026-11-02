import { useEffect, useState, type JSX } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/shared/Button';
import {
  SPELLBOOK_SITE_URL,
  SPELLBOOK_TAG_LABELS,
  SpellbookError,
  fetchSpellbookBracket,
  type SpellbookRequest,
  type SpellbookTag,
} from '@/lib/deck-analysis/spellbook-bracket';

type State =
  | { status: 'loading' }
  | { status: 'ready'; tag: SpellbookTag }
  | { status: 'unavailable' }
  | { status: 'failed' };

/** Edits land in bursts; wait for the list to settle before asking. */
const SETTLE_MS = 800;

/**
 * "Second opinion" in the Bracket panel: Commander Spellbook's own read of the
 * list, beside ours. Their tags are named (Core, Powerful, ...) and are shown
 * as theirs, credited and linked, never mapped onto B1 to B5. It is a side
 * note: while it loads or if it fails, the estimate above is untouched and
 * this line alone says so.
 */
export function SpellbookSecondOpinion({ request }: { request: SpellbookRequest }): JSX.Element {
  const [done, setDone] = useState<{
    id: string;
    result: Exclude<State, { status: 'loading' }>;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  // The list as a string so a new array with the same cards doesn't refetch.
  const key = JSON.stringify(request);
  const id = `${attempt}:${key}`;
  // An answer belongs to the list it was asked for; any other list reads as loading.
  const state: State = done?.id === id ? done.result : { status: 'loading' };

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      fetchSpellbookBracket(JSON.parse(key) as SpellbookRequest).then(
        (tag) => live && setDone({ id, result: { status: 'ready', tag } }),
        (err: unknown) =>
          live &&
          setDone({
            id,
            result: {
              status:
                err instanceof SpellbookError && err.kind === 'unavailable'
                  ? 'unavailable'
                  : 'failed',
            },
          })
      );
    }, SETTLE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, id]);

  return (
    <div className="bracket-breakdown-section spellbook-opinion">
      <h4 className="bracket-breakdown-heading">Second opinion</h4>
      <p className="spellbook-opinion-line" role="status" aria-live="polite">
        {state.status === 'loading' && (
          <span className="spellbook-opinion-muted">Asking Commander Spellbook…</span>
        )}
        {state.status === 'ready' && (
          <>
            Commander Spellbook reads this list as{' '}
            <strong className="spellbook-opinion-verdict">{SPELLBOOK_TAG_LABELS[state.tag]}</strong>
            .
          </>
        )}
        {state.status === 'unavailable' && (
          <span className="spellbook-opinion-muted">
            Commander Spellbook has no answer right now.
          </span>
        )}
        {state.status === 'failed' && (
          <span className="spellbook-opinion-muted">Couldn't reach Commander Spellbook.</span>
        )}
      </p>
      {(state.status === 'unavailable' || state.status === 'failed') && (
        <Button variant="link" onClick={() => setAttempt((n) => n + 1)}>
          Retry
        </Button>
      )}
      <p className="spellbook-opinion-note">
        Their tags are their own and don't line up one to one with Brackets 1 to 5.{' '}
        <a
          href={SPELLBOOK_SITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="card-preview-ext-link"
        >
          Commander Spellbook
          <ExternalLink
            width={12}
            height={12}
            strokeWidth={2}
            aria-hidden
            className="card-preview-ext-link-icon"
          />
        </a>
      </p>
    </div>
  );
}
