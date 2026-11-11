import './StepCard.css';
import { useId, type ReactNode } from 'react';

interface StepCardProps {
  n: number;
  title: string;
  children: ReactNode;
  className?: string;
}

/**
 * One numbered step of the generator (E1113): the same chrome for every step, so the page
 * reads as one flow down. The numeral is a label, not a control.
 */
export function StepCard({ n, title, children, className }: StepCardProps) {
  const id = useId();
  return (
    <section
      className={`deck-step${className ? ` ${className}` : ''}`}
      aria-labelledby={id}
      data-surface="sleeve"
    >
      <div className="deck-step-head">
        <span className="deck-step-num" aria-hidden>
          {n}
        </span>
        <h2 className="deck-step-title" id={id}>
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

/** The steps still to come, muted and dashed, while no commander is chosen. */
export function StepPlaceholders({
  steps,
}: {
  steps: ReadonlyArray<{ n: number; title: string; hint: string }>;
}) {
  return (
    <ol className="deck-step-later" aria-label="Steps after you choose a commander">
      {steps.map((s) => (
        <li key={s.n} className="deck-step-placeholder">
          <span className="deck-step-num" aria-hidden>
            {s.n}
          </span>
          <span className="deck-step-title">{s.title}</span>
          <span className="deck-step-hint">{s.hint}</span>
        </li>
      ))}
    </ol>
  );
}
