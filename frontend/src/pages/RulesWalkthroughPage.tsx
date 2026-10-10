import { ArrowLeft, ArrowRight, RotateCcw } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { BackLink } from '@/components/app-shell/BackLink';
import { PageHeader } from '@/components/app-shell/PageHeader';
import { RuleCitations } from '@/components/rules/RuleCitations';
import { useRulesBundle } from '@/components/rules/RulesReference';
import { WalkthroughStage } from '@/components/rules/WalkthroughStage';
import { Button } from '@/components/shared/Button';
import { EmptyState } from '@/components/shared/EmptyState';
import { Disclosure } from '@/components/shared/form';
import { getWalkthrough } from '@/lib/rules-walkthroughs';
import { track } from '@/lib/util/analytics';
import { ICON_SCALE } from '@/lib/util/icon-scale';
import { useDocumentTitle } from '@/lib/util/use-document-title';
import './RulesWalkthroughs.css';

const icon = {
  width: ICON_SCALE.inline.size,
  height: ICON_SCALE.inline.size,
  strokeWidth: ICON_SCALE.inline.stroke,
} as const;

/** "Card: 2015-08-25" → "Card, August 25, 2015". */
function formatRuling(ruling: string): string {
  const [card, date] = ruling.split(/: (?=\d{4}-\d{2}-\d{2}$)/);
  if (!date) return ruling;
  const when = new Date(`${date}T00:00:00`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  return `${card}, ${when}`;
}

/**
 * `/rules/walkthroughs/:id` — one walkthrough, a step at a time (board E357).
 * The step lives in the URL (`?step=`, 1-based) so a step is a link; the
 * arrow keys step too. Reaching the last step counts one finish for this
 * walkthrough's path, which is how the Rules Lab decides whether to grow.
 */
export function RulesWalkthroughPage() {
  const { id } = useParams();
  const walkthrough = getWalkthrough(id);
  const [params, setParams] = useSearchParams();
  const bundle = useRulesBundle();
  useDocumentTitle(walkthrough?.title);

  const total = walkthrough?.steps.length ?? 0;
  const raw = Number.parseInt(params.get('step') ?? '1', 10);
  const index = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), Math.max(total, 1)) - 1 : 0;
  const atEnd = total > 0 && index === total - 1;

  const go = (next: number) =>
    setParams(
      (p) => {
        if (next <= 0) p.delete('step');
        else p.set('step', String(next + 1));
        return p;
      },
      { replace: true }
    );

  // Arrow keys step, unless something that takes arrows has focus.
  useEffect(() => {
    if (!walkthrough) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target;
      if (
        t instanceof Element &&
        t.closest('input, textarea, select, [contenteditable="true"], [role="slider"]')
      ) {
        return;
      }
      if (e.key === 'ArrowRight' && index < total - 1) go(index + 1);
      else if (e.key === 'ArrowLeft' && index > 0) go(index - 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // One finish per walkthrough per visit, however often the last step is revisited.
  const finished = useRef(new Set<string>());
  useEffect(() => {
    if (!walkthrough || !atEnd || finished.current.has(walkthrough.id)) return;
    finished.current.add(walkthrough.id);
    track('walkthrough_finished');
  }, [walkthrough, atEnd]);

  if (!walkthrough) {
    return (
      <div className="rules-wt-page">
        <BackLink to="/rules/walkthroughs" label="Walkthroughs" />
        <EmptyState
          tagline="No walkthrough at this address."
          hint="Pick one from the list of walkthroughs."
          actions={
            <Button variant="primary" to="/rules/walkthroughs">
              See all walkthroughs
            </Button>
          }
        />
      </div>
    );
  }

  const step = walkthrough.steps[index];
  const oracle = walkthrough.oracle ? Object.entries(walkthrough.oracle) : [];

  return (
    <div className="rules-wt-page">
      <BackLink to="/rules/walkthroughs" label="Walkthroughs" />
      <PageHeader title={walkthrough.title} meta={walkthrough.summary} />

      <div className="rules-wt-intro">
        <p className="rules-wt-setup">{walkthrough.setup}</p>
        {oracle.length > 0 && (
          <Disclosure title="Card text" summary={oracle.map(([name]) => name).join(', ')}>
            <dl className="rules-wt-oracle">
              {oracle.map(([name, text]) => (
                <div key={name} className="rules-wt-oracle-entry">
                  <dt>{name}</dt>
                  <dd>{text}</dd>
                </div>
              ))}
            </dl>
            {walkthrough.rulings && (
              <p className="rules-wt-rulings">
                Follows the official rulings of{' '}
                {walkthrough.rulings.map(formatRuling).join(' and ')}.
              </p>
            )}
          </Disclosure>
        )}
      </div>

      <div className="rules-wt-body">
        <section className="rules-wt-narration" aria-label="Step">
          <div className="rules-wt-controls">
            <span className="rules-wt-progress">
              Step {index + 1} of {total}
            </span>
            <Button
              className="rules-wt-nav"
              onClick={() => go(index - 1)}
              disabled={index === 0}
              aria-keyshortcuts="ArrowLeft"
              icon={<ArrowLeft {...icon} />}
            >
              Back
            </Button>
            {atEnd ? (
              <Button className="rules-wt-nav" onClick={() => go(0)} icon={<RotateCcw {...icon} />}>
                Start over
              </Button>
            ) : (
              <Button
                variant="primary"
                className="rules-wt-nav"
                onClick={() => go(index + 1)}
                aria-keyshortcuts="ArrowRight"
                iconEnd={<ArrowRight {...icon} />}
              >
                Next
              </Button>
            )}
          </div>
          <p className="rules-wt-why" aria-live="polite">
            {step.why}
          </p>
          <RuleCitations numbers={step.cr} bundle={bundle} />
        </section>

        <WalkthroughStage
          walkthrough={walkthrough}
          step={step}
          previous={index > 0 ? walkthrough.steps[index - 1] : undefined}
        />
      </div>
    </div>
  );
}
