import './UpgradePlanSheet.css';
import { useCallback, useId, useMemo, useState, type JSX } from 'react';
import { X } from 'lucide-react';
import { Modal } from '../Modal';
import { OverflowMenu } from '../OverflowMenu';
import { Button, IconButton } from '../shared/Button';
import { MeterBar } from '../shared/MeterBar';
import { EmptyStateMark } from '../shared/EmptyStateMark';
import { ChoiceList, Disclosure, Field, SegmentedControl, SwitchRow } from '../shared/form';
import { DeckCardRow } from './DeckCardRow';
import { DeckAnalysisSkeleton } from './DeckAnalysisSkeleton';
import { useCardPriceLookup } from './use-missing-prices';
import { useMediaQuery } from '@/lib/use-media-query';
import { useCurrency, currencySymbol } from '@/lib/currency';
import { formatMoney } from '@/lib/format-money';
import { formatBracketLabel } from '@/lib/format-bracket-label';
import { toSwapAgainst, type Change } from '@/lib/deck-change';
import { planUpgrades, type PlannedMove, type UpgradeGoal } from '@/lib/upgrade-plan';
import type { UpgradePlanTools } from '@/lib/upgrade-plan-tools';
import type { PlanStep } from '@/lib/apply-upgrade-plan';
import { useToastsStore } from '@/store/toasts';
import { logger } from '@/lib/logger';

const PRESETS = [25, 50, 100] as const;
type BudgetChoice = (typeof PRESETS)[number] | 'custom';

/** Plan sections in the order upgrade guides use: the mana first, the payoffs last. */
const ROLE_GROUPS: Array<[string, string]> = [
  ['ramp', 'Ramp'],
  ['cardDraw', 'Card advantage'],
  ['removal', 'Removal'],
  ['boardwipe', 'Board wipes'],
];
const ROLE_NAMES: Record<string, string> = Object.fromEntries(ROLE_GROUPS);
/** Enough to price every candidate a Coach feed carries in practice. */
const MAX_PRICED = 200;

export interface UpgradePlanSheetProps {
  /** Add and swap candidates in Coach rank order. */
  moves: Change[];
  /** Cut candidates, weakest first. */
  cuts: Change[];
  roleCounts: Record<string, number>;
  roleTargets: Record<string, number>;
  openSlots: number;
  tools: UpgradePlanTools;
  commanderName?: string;
  analysisState?: 'pending' | 'ready' | 'error';
  edhrecMissing?: boolean;
  onRetry?: () => void;
  onApply: (steps: PlanStep[], toCopy: boolean) => Promise<void>;
  onClose: () => void;
}

function groupOf(p: PlannedMove, tools: UpgradePlanTools): string {
  const c = p.change;
  if (tools.isGameChanger(c.name) || c.isGameChanger) return 'Game Changers';
  if (c.role === 'land' || /\bLand\b/.test(c.typeLine ?? '')) return 'Mana base';
  if (c.role && ROLE_NAMES[c.role]) return ROLE_NAMES[c.role];
  if (c.lane === 'combos') return 'Combos';
  return 'Strategy';
}
const GROUP_ORDER = [
  'Game Changers',
  'Mana base',
  ...ROLE_GROUPS.map((g) => g[1]),
  'Combos',
  'Strategy',
];

/** "A", "A and B", "A, B and 2 more". */
function nameList(names: string[]): string {
  if (names.length <= 2) return names.join(' and ');
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/**
 * The upgrade plan workbench (E458): a budget and a goal in, the best swaps
 * that fit out. A bottom sheet below 1024px, two panes above, the same shell
 * as Add cards. Every control re-plans at once; nothing here calls the network
 * except the one price lookup.
 */
export function UpgradePlanSheet({
  moves,
  cuts,
  roleCounts,
  roleTargets,
  openSlots,
  tools,
  commanderName,
  analysisState,
  edhrecMissing,
  onRetry,
  onApply,
  onClose,
}: UpgradePlanSheetProps): JSX.Element {
  const titleId = useId();
  const amountId = useId();
  const wide = useMediaQuery('(min-width: 1024px)');
  const symbol = currencySymbol(useCurrency());
  const pushToast = useToastsStore((s) => s.push);

  const [budgetChoice, setBudgetChoice] = useState<BudgetChoice>(50);
  const [customAmount, setCustomAmount] = useState('40');
  const [goal, setGoal] = useState<UpgradeGoal>('hold');
  const [ownedFree, setOwnedFree] = useState(true);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  // The last untick and the picks just before it, so the card that takes its
  // place can be named and marked.
  const [lastDrop, setLastDrop] = useState<{ name: string; before: Set<string> } | null>(null);

  const budget =
    budgetChoice === 'custom' ? Math.max(0, Number.parseFloat(customAmount) || 0) : budgetChoice;

  const priceNames = useMemo(
    () => moves.filter((c) => c.ownership !== 'owned').map((c) => c.name),
    [moves]
  );
  const { prices, loaded: pricesLoaded } = useCardPriceLookup(priceNames, MAX_PRICED);

  const canMoveUp = tools.current <= 3;
  const upTarget = tools.current + 1;
  const planFor = useCallback(
    (b: number, g: UpgradeGoal, drop: Set<string>) =>
      planUpgrades(
        {
          moves,
          cuts,
          roleCounts,
          roleTargets,
          openSlots,
          priceOf: (n) => prices.get(n.toLowerCase()) ?? null,
          raisesBracket: tools.raisesBracket,
          isGameChanger: (c) => c.isGameChanger === true || tools.isGameChanger(c.name),
          gameChangerRoom: upTarget >= 4 ? Infinity : Math.max(0, 3 - tools.gameChangersInDeck),
          ceiling: g === 'up' ? upTarget : tools.estimate,
          estimate: tools.estimateAfter,
        },
        { budget: b, goal: g, ownedFree, excluded: drop }
      ),
    [moves, cuts, roleCounts, roleTargets, openSlots, prices, tools, upTarget, ownedFree]
  );

  const plan = useMemo(() => planFor(budget, goal, excluded), [planFor, budget, goal, excluded]);
  const presetCounts = useMemo(
    () => PRESETS.map((b) => planFor(b, goal, excluded).picks.length),
    [planFor, goal, excluded]
  );

  const estimateAfter =
    plan.estimateAfter ??
    tools.estimateAfter(
      plan.picks.map((p) => p.change.name),
      plan.picks.flatMap((p) => (p.cutName ? [p.cutName] : []))
    );
  const toBuy = plan.picks.filter((p) => p.cost > 0);
  const swapIn = lastDrop ? plan.picks.filter((p) => !lastDrop.before.has(p.change.name)) : [];

  const toggle = (name: string) => {
    const dropping = !excluded.has(name);
    setLastDrop(dropping ? { name, before: new Set(plan.picks.map((p) => p.change.name)) } : null);
    setExcluded((prev) => {
      const next = new Set(prev);
      if (dropping) next.add(name);
      else next.delete(name);
      return next;
    });
  };

  const groups = useMemo(() => {
    const byGroup = new Map<string, PlannedMove[]>();
    for (const p of plan.picks) {
      const g = groupOf(p, tools);
      byGroup.set(g, [...(byGroup.get(g) ?? []), p]);
    }
    return GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => [g, byGroup.get(g)!] as const);
  }, [plan, tools]);
  const droppedMoves = moves.filter((c) => excluded.has(c.name));

  const roleChanges = ROLE_GROUPS.filter(
    ([role]) => (plan.rolesAfter[role] ?? 0) !== (roleCounts[role] ?? 0)
  ).map(([role, label]) => `${label} ${roleCounts[role] ?? 0} → ${plan.rolesAfter[role] ?? 0}`);

  const apply = async (toCopy: boolean) => {
    setApplying(true);
    try {
      await onApply(
        plan.picks.map((p) => ({ addName: p.change.name, cutName: p.cutName })),
        toCopy
      );
    } finally {
      setApplying(false);
    }
  };

  const copyList = async () => {
    const text = toBuy.map((p) => `1 ${p.change.name}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      pushToast({
        message: `Copied ${toBuy.length} ${toBuy.length === 1 ? 'card' : 'cards'}`,
        tone: 'success',
      });
    } catch (err) {
      logger.warn('[UpgradePlan] clipboard write failed', err);
      pushToast({ message: "Couldn't copy the list", tone: 'error' });
    }
  };

  const goalLabel =
    goal === 'hold'
      ? `Stay at Bracket ${tools.current}`
      : goal === 'up'
        ? `Move up to Bracket ${upTarget}`
        : 'Any bracket';
  const budgetLabel = formatMoney(budget, { wholeDollars: Number.isInteger(budget) });

  const controls = (
    <div className="upgrade-plan-controls">
      <Field label="Budget">
        <SegmentedControl<BudgetChoice>
          ariaLabel="Budget"
          fill
          value={budgetChoice}
          onChange={setBudgetChoice}
          options={[
            ...PRESETS.map((b, i) => ({
              value: b as BudgetChoice,
              ariaLabel: `${symbol}${b}, ${presetCounts[i]} swaps`,
              label: (
                <span className="upgrade-plan-preset">
                  <span className="upgrade-plan-preset-amount">
                    {symbol}
                    {b}
                  </span>
                  <span className="upgrade-plan-preset-count">{presetCounts[i]} swaps</span>
                </span>
              ),
            })),
            {
              value: 'custom' as BudgetChoice,
              ariaLabel: 'Custom amount',
              label: (
                <span className="upgrade-plan-preset">
                  <span className="upgrade-plan-preset-amount">Custom</span>
                  <span className="upgrade-plan-preset-count">Any amount</span>
                </span>
              ),
            },
          ]}
        />
      </Field>
      {budgetChoice === 'custom' && (
        <Field label="Amount" htmlFor={amountId}>
          <span className="upgrade-plan-amount">
            <span aria-hidden="true">{symbol}</span>
            <input
              id={amountId}
              className="upgrade-plan-amount-input"
              type="number"
              inputMode="decimal"
              min={0}
              step={1}
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
            />
          </span>
        </Field>
      )}
      <Field label="Goal">
        <ChoiceList<UpgradeGoal>
          ariaLabel="Goal"
          value={goal}
          onChange={setGoal}
          options={[
            {
              value: 'hold',
              label: `Stay at Bracket ${tools.current}`,
              hint: 'Leaves out anything that moves the bracket.',
            },
            {
              value: 'up',
              label: canMoveUp ? `Move up to Bracket ${upTarget}` : 'Move up a bracket',
              hint: canMoveUp
                ? 'Game Changers go in first, then the rest.'
                : 'This deck already plays at the top bracket.',
              disabled: !canMoveUp,
            },
            { value: 'any', label: 'Any bracket', hint: 'The strongest cards the money buys.' },
          ]}
        />
      </Field>
      <SwitchRow
        label="Use my cards first"
        hint="Cards you own and aren't using in another deck cost nothing."
        checked={ownedFree}
        onChange={setOwnedFree}
      />
    </div>
  );

  const leftOut = plan.leftOutForBracket.map((c) => c.name);
  const summary = (
    <div className="upgrade-plan-summary" aria-live="polite">
      <p className="upgrade-plan-spend">
        <span className="upgrade-plan-spend-amount">{formatMoney(plan.spent)}</span>
        <span className="upgrade-plan-spend-of">of {budgetLabel}</span>
      </p>
      <MeterBar value={plan.spent} max={Math.max(budget, plan.spent, 1)} size="md" />
      <dl className="upgrade-plan-stats">
        <div>
          <dt>Swaps</dt>
          <dd>{plan.picks.length}</dd>
        </div>
        <div>
          <dt>From your cards</dt>
          <dd>{plan.fromCollection}</dd>
        </div>
        <div>
          <dt>To buy</dt>
          <dd>{toBuy.length}</dd>
        </div>
      </dl>
      <p className="upgrade-plan-line">
        <span className="upgrade-plan-line-key">Estimate</span>
        <span>
          {estimateAfter === tools.estimate
            ? `Stays ${formatBracketLabel(tools.estimate)}`
            : `${formatBracketLabel(tools.estimate)} → ${formatBracketLabel(estimateAfter)}`}
        </span>
      </p>
      {roleChanges.length > 0 && (
        <p className="upgrade-plan-line">
          <span className="upgrade-plan-line-key">Roles</span>
          <span>{roleChanges.join(' · ')}</span>
        </p>
      )}
      {goal === 'hold' && leftOut.length > 0 && (
        <div className="upgrade-plan-note is-warn">
          <p>
            Left out {nameList(leftOut)}. {leftOut.length === 1 ? 'It moves' : 'Each moves'} the
            deck up a bracket.
          </p>
          {canMoveUp && (
            <Button variant="link" onClick={() => setGoal('up')}>
              Plan for Bracket {upTarget}
            </Button>
          )}
        </div>
      )}
      {goal === 'up' && estimateAfter < upTarget && (
        <div className="upgrade-plan-note is-warn">
          <p>
            Still {formatBracketLabel(estimateAfter)}. Bracket {upTarget} needs a Game Changer or a
            combo this budget doesn't reach.
          </p>
        </div>
      )}
      {goal === 'up' && estimateAfter >= upTarget && leftOut.length > 0 && (
        <div className="upgrade-plan-note">
          <p>
            Left out {nameList(leftOut)} to stay at Bracket {upTarget}.
          </p>
        </div>
      )}
      {plan.nextOverBudget && (
        <p className="upgrade-plan-line">
          <span className="upgrade-plan-line-key">Next</span>
          <span>
            {plan.nextOverBudget.change.name}, {formatMoney(plan.nextOverBudget.cost)}
          </span>
        </p>
      )}
      {plan.unpriced.length > 0 && (
        <p className="upgrade-plan-muted">
          Left out {plan.unpriced.length} {plan.unpriced.length === 1 ? 'card' : 'cards'} with no
          price today.
        </p>
      )}
    </div>
  );

  const rowFor = (p: PlannedMove, isNew: boolean) => {
    const base =
      p.cutName && p.change.type !== 'swap' ? toSwapAgainst(p.change, p.cutName) : p.change;
    const display: Change = {
      ...base,
      reason: p.cutName
        ? `Replaces ${p.cutName}${base.reason ? `: ${base.reason}` : ''}`
        : (base.reason ?? 'Fills an empty slot'),
      isGameChanger: base.isGameChanger || tools.isGameChanger(base.name) || undefined,
      deltaPrice: p.cost > 0 ? p.cost : undefined,
    };
    return (
      <li key={p.change.name} className={`upgrade-plan-row${isNew ? ' is-new' : ''}`}>
        <input
          type="checkbox"
          className="upgrade-plan-check"
          checked
          onChange={() => toggle(p.change.name)}
          aria-label={`Include ${p.change.name}`}
        />
        <DeckCardRow as="div" change={display} commanderName={commanderName} />
      </li>
    );
  };

  const loading = analysisState === 'pending' || (analysisState !== 'error' && !pricesLoaded);
  let body: JSX.Element;
  if (analysisState === 'error' || (edhrecMissing && moves.length === 0)) {
    body = (
      <DeckAnalysisSkeleton
        status={analysisState === 'error' ? 'error' : 'edhrec-missing'}
        onRetry={onRetry}
      />
    );
  } else if (loading) {
    body = <DeckAnalysisSkeleton status="pending" />;
  } else if (plan.picks.length === 0) {
    body = (
      <div className="empty-state upgrade-plan-empty">
        <EmptyStateMark />
        <p className="empty-state-tagline">Nothing fits {budgetLabel}.</p>
        <p className="empty-state-hint">
          {ownedFree
            ? 'Raise the budget to see swaps.'
            : 'Raise the budget or use your cards first.'}
        </p>
        {!ownedFree && (
          <Button variant="secondary" onClick={() => setOwnedFree(true)}>
            Use my cards first
          </Button>
        )}
      </div>
    );
  } else {
    const newNames = new Set(swapIn.map((p) => p.change.name));
    body = (
      <>
        {lastDrop && (
          <p className="upgrade-plan-note upgrade-plan-change" role="status">
            Left out {lastDrop.name}.
            {swapIn.length > 0 &&
              ` ${nameList(swapIn.map((p) => p.change.name))} ${swapIn.length === 1 ? 'takes' : 'take'} its place.`}
          </p>
        )}
        {groups.map(([group, picks]) => (
          <section key={group} className="upgrade-plan-group" aria-label={group}>
            <h3 className="upgrade-plan-group-title">
              {group} <span className="upgrade-plan-group-count">{picks.length}</span>
            </h3>
            <ul className="upgrade-plan-list">
              {picks.map((p) => rowFor(p, newNames.has(p.change.name)))}
            </ul>
          </section>
        ))}
        {droppedMoves.length > 0 && (
          <section className="upgrade-plan-group" aria-label="Left out by you">
            <h3 className="upgrade-plan-group-title">
              Left out by you{' '}
              <span className="upgrade-plan-group-count">{droppedMoves.length}</span>
            </h3>
            <ul className="upgrade-plan-list">
              {droppedMoves.map((c) => (
                <li key={c.name} className="upgrade-plan-row is-dropped">
                  <input
                    type="checkbox"
                    className="upgrade-plan-check"
                    checked={false}
                    onChange={() => toggle(c.name)}
                    aria-label={`Include ${c.name}`}
                  />
                  <DeckCardRow as="div" change={c} commanderName={commanderName} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </>
    );
  }

  const count = plan.picks.length;
  const ready = !loading && count > 0;
  const applyLabel = `Apply ${count} ${count === 1 ? 'swap' : 'swaps'}`;

  return (
    <Modal
      onClose={onClose}
      className="modal upgrade-plan-modal"
      backdropClassName="upgrade-plan-backdrop"
      labelledBy={titleId}
      dismissable={!applying}
    >
      <div className="modal-header upgrade-plan-header">
        <div>
          {commanderName && <p className="upgrade-plan-eyebrow">{commanderName}</p>}
          <h2 id={titleId}>Upgrade plan</h2>
        </div>
        <IconButton
          className="modal-close"
          label="Close"
          icon={<X size={20} />}
          onClick={onClose}
        />
      </div>
      <div className="upgrade-plan-panes">
        <div className="upgrade-plan-side">
          {wide ? (
            controls
          ) : (
            <Disclosure
              title="Settings"
              summary={`${budgetLabel} · ${goalLabel} · ${ownedFree ? 'Your cards first' : 'Buy everything'}`}
            >
              {controls}
            </Disclosure>
          )}
          {ready && summary}
        </div>
        <div className="upgrade-plan-main">{body}</div>
      </div>
      <div className="modal-footer upgrade-plan-footer">
        <p className="upgrade-plan-answer">
          {ready ? (
            <>
              <strong>
                {count} {count === 1 ? 'swap' : 'swaps'}
              </strong>{' '}
              · {formatMoney(plan.spent)} to buy
            </>
          ) : null}
        </p>
        {wide ? (
          <>
            <Button variant="secondary" disabled={!ready || toBuy.length === 0} onClick={copyList}>
              Copy shopping list
            </Button>
            <Button variant="secondary" disabled={!ready || applying} onClick={() => apply(true)}>
              Apply to a copy
            </Button>
          </>
        ) : (
          <OverflowMenu
            ariaLabel="More plan actions"
            items={[
              {
                label: 'Copy shopping list',
                onClick: () => void copyList(),
                disabled: !ready || toBuy.length === 0,
              },
              {
                label: 'Apply to a copy',
                onClick: () => void apply(true),
                disabled: !ready || applying,
              },
            ]}
          />
        )}
        <Button variant="primary" disabled={!ready || applying} onClick={() => apply(false)}>
          {applyLabel}
        </Button>
      </div>
    </Modal>
  );
}
