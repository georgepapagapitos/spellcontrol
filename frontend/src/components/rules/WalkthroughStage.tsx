import { Chip } from '@/components/shared/Chip';
import { Count } from '@/components/shared/Count';
import { SectionHeader } from '@/components/shared/SectionHeader';
import { Surface } from '@/components/shared/Surface';
import type { StackItem, Walkthrough, WalkthroughStep } from '@/lib/rules-walkthroughs';
import './Walkthrough.css';

interface Props {
  walkthrough: Walkthrough;
  step: WalkthroughStep;
  /** The step before, so what just arrived can be marked. */
  previous?: WalkthroughStep;
}

const KIND_LABEL: Record<StackItem['kind'], string> = {
  spell: 'Spell',
  ability: 'Ability',
  trigger: 'Trigger',
};

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The table at one step of a walkthrough: who holds priority, the stack with
 * its top first, the triggers waiting to go on it, and the permanents that
 * matter. A read-only picture; the page owns stepping.
 */
export function WalkthroughStage({ walkthrough, step, previous }: Props) {
  const nameOf = (id: string) => walkthrough.players.find((p) => p.id === id)?.name ?? id;
  const before = new Set(
    [...(previous?.stack ?? []), ...(previous?.pending ?? [])].map((i) => i.id)
  );
  const n = walkthrough.players.length;
  const top = step.stack.length - 1;

  const item = (it: StackItem, isTop: boolean) => (
    <Surface
      as="li"
      variant="sleeve"
      key={it.id}
      className={`wt-item${isTop ? ' wt-item--top' : ''}`}
      data-new={previous && !before.has(it.id) ? '' : undefined}
    >
      <div className="wt-item-head">
        <span className="wt-item-name">{it.name}</span>
        <Chip className="wt-chip" tone={it.kind === 'spell' ? 'neutral' : 'accent'}>
          {KIND_LABEL[it.kind]}
        </Chip>
        {isTop && (
          <Chip className="wt-chip" tone="info">
            Top
          </Chip>
        )}
      </div>
      {it.text && <p className="wt-item-text">{it.text}</p>}
      <p className="wt-item-meta">
        {nameOf(it.controller)}
        {it.targets && it.targets.length > 0 && ` · Targets ${joinNames(it.targets)}`}
      </p>
    </Surface>
  );

  return (
    <div className="wt-stage">
      <section className="wt-section" aria-labelledby="wt-players-title">
        <SectionHeader
          title="Players"
          id="wt-players-title"
          variant="overline"
          className="wt-section-row"
          meta={
            <span className="wt-section-meta">
              {step.priority ? `${step.passes} of ${n} passed in a row` : 'Nobody has priority'}
            </span>
          }
        />
        <ul className="wt-players" role="list">
          {walkthrough.players.map((p, i) => {
            const has = step.priority === p.id;
            const permanents = step.battlefield[p.id] ?? [];
            return (
              <Surface
                as="li"
                variant="sleeve"
                key={p.id}
                className={`wt-player${has ? ' wt-player--priority' : ''}`}
              >
                <div className="wt-player-head">
                  <span className="wt-player-name">{p.name}</span>
                  {i === 0 && <span className="wt-player-role">Active</span>}
                  {has && (
                    <Chip className="wt-chip wt-chip--priority" tone="accent">
                      Priority
                    </Chip>
                  )}
                </div>
                {permanents.length > 0 && (
                  <ul className="wt-permanents" aria-label={`${p.name}'s battlefield`}>
                    {permanents.map((name) => (
                      <li key={name}>{name}</li>
                    ))}
                  </ul>
                )}
              </Surface>
            );
          })}
        </ul>
      </section>

      <section className="wt-section" aria-labelledby="wt-stack-title">
        <SectionHeader
          title="Stack"
          id="wt-stack-title"
          variant="overline"
          className="wt-section-row"
          meta={<Count className="wt-count" placement="inline" value={step.stack.length} />}
        />
        {step.stack.length === 0 ? (
          <p className="wt-empty">Empty</p>
        ) : (
          <ol className="list-stack" aria-label="Stack, top first">
            {step.stack.map((it, i) => item(it, i === top)).reverse()}
          </ol>
        )}
      </section>

      {step.pending.length > 0 && (
        <section className="wt-section wt-section--waiting" aria-labelledby="wt-waiting-title">
          <SectionHeader
            title="Waiting to go on the stack"
            id="wt-waiting-title"
            variant="overline"
            className="wt-section-row"
            meta={<Count className="wt-count" placement="inline" value={step.pending.length} />}
          />
          <ul className="list-stack" role="list">
            {step.pending.map((it) => item(it, false))}
          </ul>
        </section>
      )}
    </div>
  );
}
