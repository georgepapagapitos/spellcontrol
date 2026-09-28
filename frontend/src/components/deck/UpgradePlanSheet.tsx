import './UpgradePlanSheet.css';
import { useCallback, useEffect, useId, useMemo, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Modal } from '../Modal';
import { OverflowMenu } from '../OverflowMenu';
import { Button, IconButton } from '../shared/Button';
import { MeterBar } from '../shared/MeterBar';
import { EmptyState } from '../shared/EmptyState';
import { CopyButton } from '../shared/CopyButton';
import { copyToClipboard } from '@/lib/clipboard';
import { ChoiceList, Disclosure, Field, SegmentedControl, SwitchRow } from '../shared/form';
import { DeckCardRow } from './DeckCardRow';
import { DeckAnalysisSkeleton } from './DeckAnalysisSkeleton';
import { DeckHoverPeek } from './DeckHoverPeek';
import { useDeckHoverPeek } from './use-deck-hover-peek';
import { useCardCarousel, type CarouselEntry } from './useCardCarousel';
import { useCardPriceLookup } from './use-missing-prices';
import { useTouchPeek } from '@/lib/use-touch-peek';
import { useCardThumb } from '@/lib/card-thumbs';
import { useMediaQuery } from '@/lib/use-media-query';
import { useCurrency, currencySymbol } from '@/lib/currency';
import { formatMoney } from '@/lib/format-money';
import { formatBracketLabel } from '@/lib/format-bracket-label';
import { toSwapAgainst, type Change } from '@/lib/deck-change';
import { planUpgrades, type LeftOut, type PlannedMove, type UpgradeGoal } from '@/lib/upgrade-plan';
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
/** Every candidate a Coach feed carries, near-miss combos included. A cap
 *  under the list's length left the tail reading "no price" (E467). */
const MAX_PRICED = 1000;

export interface UpgradePlanSheetProps {
  /** Keys the settings this device remembers for the deck. */
  deckId: string;
  /** Add and swap candidates in Coach rank order. */
  moves: Change[];
  /** The Coach tier of a move (1 structural … 3 polish). */
  tierOf?: (c: Change) => 1 | 2 | 3;
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

interface Saved {
  budgetChoice: BudgetChoice;
  customAmount: string;
  goal: UpgradeGoal;
  ownedFree: boolean;
}

/** Settings remembered per deck on this device. A convenience only: a missing
 *  or unreadable entry falls back to the defaults. */
function readSaved(key: string): Partial<Saved> {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<Saved> | null;
    if (!raw || typeof raw !== 'object') return {};
    const out: Partial<Saved> = {};
    if (raw.budgetChoice === 'custom' || PRESETS.includes(raw.budgetChoice as 25)) {
      out.budgetChoice = raw.budgetChoice;
    }
    if (typeof raw.customAmount === 'string') out.customAmount = raw.customAmount;
    if (raw.goal === 'hold' || raw.goal === 'up' || raw.goal === 'any') out.goal = raw.goal;
    if (typeof raw.ownedFree === 'boolean') out.ownedFree = raw.ownedFree;
    return out;
  } catch {
    return {};
  }
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

/** One card in the Left out list: its art opens the preview. */
function LeftOutItem({
  name,
  price,
  why,
  onPreview,
}: {
  name: string;
  price: number | null;
  why: string;
  onPreview: () => void;
}): JSX.Element {
  const thumb = useCardThumb(name);
  return (
    <li className="upgrade-plan-leftout-item">
      <button
        type="button"
        className="upgrade-plan-leftout-art"
        data-peek-name={name}
        onClick={onPreview}
        aria-label={`Preview ${name}`}
      >
        {thumb && <img src={thumb} alt="" loading="lazy" />}
      </button>
      <span className="upgrade-plan-leftout-text">
        <span className="upgrade-plan-leftout-name">
          {name}
          {price != null && (
            <span className="upgrade-plan-leftout-price">{formatMoney(price)}</span>
          )}
        </span>
        <span className="upgrade-plan-leftout-why">{why}</span>
      </span>
    </li>
  );
}

/**
 * The upgrade plan workbench (E458, v2 E467): a budget and a goal in, the
 * best swaps that fit out. A bottom sheet below 1024px, two panes above, the
 * same shell as Add cards. Every control re-plans at once; nothing here calls
 * the network except the one price lookup.
 */
export function UpgradePlanSheet({
  deckId,
  moves,
  tierOf,
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
  const carousel = useCardCarousel('Upgrade plan');
  const hoverPeek = useDeckHoverPeek();
  const peekUrl = useCardThumb(hoverPeek.peek?.name, 'normal');
  const touchPeek = useTouchPeek();
  const touchPeekUrl = useCardThumb(touchPeek.peek?.name, 'normal');

  const canMoveUp = tools.current <= 3;
  const upTarget = tools.current + 1;
  const storeKey = `sc-upgrade-plan:${deckId}`;
  const [saved] = useState(() => readSaved(storeKey));
  const [budgetChoice, setBudgetChoice] = useState<BudgetChoice>(saved.budgetChoice ?? 50);
  const [customAmount, setCustomAmount] = useState(saved.customAmount ?? '40');
  const [goal, setGoal] = useState<UpgradeGoal>(
    saved.goal === 'up' && !canMoveUp ? 'hold' : (saved.goal ?? 'hold')
  );
  const [ownedFree, setOwnedFree] = useState(saved.ownedFree ?? true);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  // The last untick or keep, with the plan just before it, so the note can
  // name what took its place.
  const [lastEvent, setLastEvent] = useState<
    | { kind: 'drop'; name: string; before: Set<string> }
    | { kind: 'keep'; name: string; freed: string | null }
    | null
  >(null);

  useEffect(() => {
    try {
      localStorage.setItem(
        storeKey,
        JSON.stringify({ budgetChoice, customAmount, goal, ownedFree } satisfies Saved)
      );
    } catch {
      /* private mode or storage full: the settings just don't persist */
    }
  }, [storeKey, budgetChoice, customAmount, goal, ownedFree]);

  const budget =
    budgetChoice === 'custom' ? Math.max(0, Number.parseFloat(customAmount) || 0) : budgetChoice;

  const priceNames = useMemo(
    () => moves.filter((c) => c.ownership !== 'owned').map((c) => c.name),
    [moves]
  );
  const { prices, loaded: pricesLoaded } = useCardPriceLookup(priceNames, MAX_PRICED);

  // The feed's own cuts first, then the deck's weakest cards by play-rate.
  const allCuts = useMemo(() => {
    const seen = new Set(cuts.map((c) => c.name));
    return [...cuts, ...tools.weakestCuts.filter((c) => !seen.has(c.name))];
  }, [cuts, tools]);
  const ceiling = goal === 'up' ? upTarget : tools.current;

  const plan = useMemo(
    () =>
      planUpgrades(
        {
          moves,
          cuts: allCuts,
          roleCounts,
          roleTargets,
          openSlots,
          priceOf: (n) => prices.get(n.toLowerCase()) ?? null,
          // From Bracket 4 up, Game Changers and tutors are allowed, so holding
          // needs no pre-filter: the re-estimate still stops a move to 5.
          raisesBracket: goal === 'hold' && tools.current >= 4 ? () => false : tools.raisesBracket,
          isGameChanger: (c) => c.isGameChanger === true || tools.isGameChanger(c.name),
          gameChangerRoom: upTarget >= 4 ? Infinity : Math.max(0, 3 - tools.gameChangersInDeck),
          ceiling,
          estimate: tools.estimateAfter,
          tierOf,
          basics: tools.basics,
          fetchers: tools.fetchers,
        },
        { budget, goal, ownedFree, excluded, kept }
      ),
    [
      moves,
      allCuts,
      roleCounts,
      roleTargets,
      openSlots,
      prices,
      tools,
      upTarget,
      ceiling,
      tierOf,
      budget,
      goal,
      ownedFree,
      excluded,
      kept,
    ]
  );

  const estimateAfter =
    plan.estimateAfter ??
    tools.estimateAfter(
      plan.picks.map((p) => p.change.name),
      plan.picks.flatMap((p) => (p.cutName ? [p.cutName] : []))
    );
  const toBuy = plan.picks.filter((p) => p.cost > 0);
  const left = budget - plan.spent;
  const swapIn =
    lastEvent?.kind === 'drop'
      ? plan.picks.filter((p) => !lastEvent.before.has(p.change.name))
      : [];

  const toggle = (name: string) => {
    const dropping = !excluded.has(name);
    setLastEvent(
      dropping
        ? { kind: 'drop', name, before: new Set(plan.picks.map((p) => p.change.name)) }
        : null
    );
    setExcluded((prev) => {
      const next = new Set(prev);
      if (dropping) next.add(name);
      else next.delete(name);
      return next;
    });
  };
  const keep = (cutName: string) => {
    const freed = plan.picks.find((p) => p.cutName === cutName)?.change.name ?? null;
    setLastEvent({ kind: 'keep', name: cutName, freed });
    setKept((prev) => new Set(prev).add(cutName));
  };
  const unkeep = (cutName: string) => {
    setLastEvent(null);
    setKept((prev) => {
      const next = new Set(prev);
      next.delete(cutName);
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

  // One carousel over everything on screen: each pick, then the card it cuts.
  const previewEntries = useMemo<CarouselEntry[]>(
    () => [
      ...plan.picks.flatMap((p) => [
        {
          name: p.change.name,
          label: p.cost > 0 ? formatMoney(p.cost) : 'From your collection',
        },
        ...(p.cutName ? [{ name: p.cutName, label: `Cut for ${p.change.name}` }] : []),
      ]),
      ...plan.leftOut.map((l) => ({ name: l.change.name, label: 'Left out' })),
      ...(plan.nextOverBudget ? [{ name: plan.nextOverBudget.change.name, label: 'Next' }] : []),
    ],
    [plan]
  );
  const preview = useCallback(
    (name: string) => {
      const known = previewEntries.some((e) => e.name === name);
      carousel.open(known ? previewEntries : [{ name, label: '' }], name);
    },
    [carousel, previewEntries]
  );

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

  const buildShoppingListText = () => toBuy.map((p) => `1 ${p.change.name}`).join('\n');

  // Only the narrow (OverflowMenu) rendering of "Copy shopping list" uses
  // this — its trigger disappears into the closed menu, so it confirms with
  // a toast. The wide rendering is a persistent Button and confirms in place
  // via CopyButton instead (STYLE_GUIDE § Verbs — Copy).
  const copyListFromMenu = async () => {
    const ok = await copyToClipboard(buildShoppingListText());
    if (ok) {
      pushToast({
        message: `Copied ${toBuy.length} ${toBuy.length === 1 ? 'card' : 'cards'}`,
        tone: 'success',
      });
    } else {
      logger.warn('[UpgradePlan] clipboard write failed');
      pushToast({ message: "Couldn't copy the list.", tone: 'error' });
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
            ...PRESETS.map((b) => ({
              value: b as BudgetChoice,
              label: (
                <span className="upgrade-plan-preset-amount">
                  {symbol}
                  {b}
                </span>
              ),
              ariaLabel: `${symbol}${b}`,
            })),
            { value: 'custom' as BudgetChoice, label: 'Custom', ariaLabel: 'Custom amount' },
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
                : 'Bracket 4 is the highest a plan builds to.',
              disabled: !canMoveUp,
            },
            { value: 'any', label: 'Any bracket', hint: 'The strongest cards the money buys.' },
          ]}
        />
      </Field>
      <SwitchRow
        label="Use cards I own"
        hint="Cards you own and aren't using in another deck are free and don't use the budget."
        checked={ownedFree}
        onChange={setOwnedFree}
      />
    </div>
  );

  const leftOutWhy = (l: LeftOut): string => {
    switch (l.reason) {
      case 'bracket':
        return `${tools.bracketReason(l.change)}. Moves the deck past Bracket ${ceiling}.`;
      case 'game-changer-limit':
        return `Game Changer. Bracket ${upTarget} allows three.`;
      case 'power':
        return `Pushes the deck's power past Bracket ${ceiling}.`;
      case 'no-price':
        return 'No price today.';
    }
  };
  // Bracket reasons first, then the next pick, then cards with no price.
  const leftOutItems = [
    ...plan.leftOut
      .filter((l) => l.reason !== 'no-price')
      .map((l) => ({ name: l.change.name, price: l.cost, why: leftOutWhy(l) })),
    ...(plan.nextOverBudget
      ? [
          {
            name: plan.nextOverBudget.change.name,
            price: plan.nextOverBudget.cost,
            why: `Next pick. ${formatMoney(plan.nextOverBudget.cost - left)} over what's left.`,
          },
        ]
      : []),
    ...plan.leftOut
      .filter((l) => l.reason === 'no-price')
      .map((l) => ({ name: l.change.name, price: null, why: leftOutWhy(l) })),
  ];
  const bracketLeftOut = plan.leftOut.some(
    (l) => l.reason === 'bracket' || l.reason === 'game-changer-limit'
  );

  const summary = (
    <div className="upgrade-plan-summary" aria-live="polite">
      <div className="upgrade-plan-block">
        <p className="upgrade-plan-block-label">To buy</p>
        <p className="upgrade-plan-spend">
          <span className="upgrade-plan-spend-amount">{formatMoney(plan.spent)}</span>
          <span className="upgrade-plan-spend-of">
            of {budgetLabel} · {toBuy.length} {toBuy.length === 1 ? 'card' : 'cards'}
          </span>
        </p>
        <MeterBar value={plan.spent} max={Math.max(budget, plan.spent, 1)} size="md" />
      </div>
      {ownedFree && plan.fromCollection > 0 && (
        <div className="upgrade-plan-block is-owned">
          <p className="upgrade-plan-block-label">From your collection</p>
          <p className="upgrade-plan-spend">
            <span className="upgrade-plan-spend-count">
              {plan.fromCollection} {plan.fromCollection === 1 ? 'card' : 'cards'}
            </span>
            <span className="upgrade-plan-spend-of">free, no budget used</span>
          </p>
        </div>
      )}
      {left >= 1 && (
        <p className="upgrade-plan-note">
          {plan.spent === 0
            ? `Nothing worth buying fits ${budgetLabel}.`
            : `Nothing else worth buying fits the ${formatMoney(left)} left.`}
          {plan.nextOverBudget &&
            ` Next: ${plan.nextOverBudget.change.name}, ${formatMoney(plan.nextOverBudget.cost)}.`}
        </p>
      )}
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
      {goal === 'up' && estimateAfter < upTarget && (
        <div className="upgrade-plan-note is-warn">
          <p>
            Still {formatBracketLabel(estimateAfter)}. Bracket {upTarget} needs a Game Changer or a
            combo this budget doesn't reach.
          </p>
        </div>
      )}
      {leftOutItems.length > 0 && (
        <details className="upgrade-plan-leftout">
          <summary>
            Left out <span className="upgrade-plan-group-count">{leftOutItems.length}</span>
          </summary>
          <ul className="upgrade-plan-leftout-list">
            {leftOutItems.map((item) => (
              <LeftOutItem
                key={item.name}
                name={item.name}
                price={item.price}
                why={item.why}
                onPreview={() => preview(item.name)}
              />
            ))}
          </ul>
          {goal === 'hold' && bracketLeftOut && canMoveUp && (
            <Button variant="link" onClick={() => setGoal('up')}>
              Plan for Bracket {upTarget}
            </Button>
          )}
        </details>
      )}
    </div>
  );

  const rowFor = (p: PlannedMove, isNew: boolean) => {
    // A pre-paired swap the plan moved onto another cut (its own was kept)
    // gets rebuilt against the new one: its art and its engine reason both
    // described the card it no longer replaces.
    const reslotted = p.change.type === 'swap' && p.cutName !== p.change.inName;
    const base =
      p.cutName && (p.change.type !== 'swap' || reslotted)
        ? { ...toSwapAgainst(p.change, p.cutName), reason: reslotted ? undefined : p.change.reason }
        : p.change;
    const display: Change = {
      ...base,
      // A land upgrade's own reason already names the land it replaces.
      reason:
        p.cutName && !base.reason?.includes(p.cutName)
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
        <div className="upgrade-plan-row-main">
          <DeckCardRow
            as="div"
            change={display}
            commanderName={commanderName}
            peekName={p.change.name}
            onPreview={() => preview(p.change.name)}
            onPreviewOut={p.cutName ? () => preview(p.cutName!) : undefined}
          />
          {p.cutName && (
            <Button variant="link" className="upgrade-plan-keep" onClick={() => keep(p.cutName!)}>
              Keep {p.cutName}
            </Button>
          )}
        </div>
      </li>
    );
  };

  const loading = analysisState === 'pending' || (analysisState !== 'error' && !pricesLoaded);
  const keptNote =
    lastEvent?.kind === 'keep'
      ? (() => {
          const moved = lastEvent.freed
            ? plan.picks.find((p) => p.change.name === lastEvent.freed)
            : undefined;
          return moved?.cutName
            ? `Kept ${lastEvent.name}. ${moved.change.name} replaces ${moved.cutName} instead.`
            : lastEvent.freed
              ? `Kept ${lastEvent.name}. ${lastEvent.freed} had nowhere else to go.`
              : `Kept ${lastEvent.name}.`;
        })()
      : null;

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
  } else if (plan.picks.length === 0 && kept.size === 0 && excluded.size === 0) {
    body = (
      <EmptyState
        className="upgrade-plan-empty"
        tagline={`Nothing fits ${budgetLabel}.`}
        hint={
          ownedFree ? 'Raise the budget to see swaps.' : 'Raise the budget or use cards you own.'
        }
        actions={
          !ownedFree && (
            <Button variant="secondary" onClick={() => setOwnedFree(true)}>
              Use cards I own
            </Button>
          )
        }
      />
    );
  } else {
    const newNames = new Set(swapIn.map((p) => p.change.name));
    if (lastEvent?.kind === 'keep' && lastEvent.freed) newNames.add(lastEvent.freed);
    body = (
      <>
        {lastEvent?.kind === 'drop' && (
          <p className="upgrade-plan-note upgrade-plan-change" role="status">
            Left out {lastEvent.name}.
            {swapIn.length > 0 &&
              ` ${nameList(swapIn.map((p) => p.change.name))} ${swapIn.length === 1 ? 'takes' : 'take'} its place.`}
          </p>
        )}
        {keptNote && (
          <p className="upgrade-plan-note upgrade-plan-change" role="status">
            {keptNote}
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
        {kept.size > 0 && (
          <section className="upgrade-plan-group" aria-label="Kept in the deck">
            <h3 className="upgrade-plan-group-title">
              Kept in the deck <span className="upgrade-plan-group-count">{kept.size}</span>
            </h3>
            <ul className="upgrade-plan-list">
              {[...kept].map((name) => (
                <li key={name} className="upgrade-plan-row is-kept">
                  <div className="upgrade-plan-row-main">
                    <DeckCardRow
                      as="div"
                      change={{ id: `kept:${name}`, type: 'cut', lane: 'upgrade', name }}
                      commanderName={commanderName}
                      peekName={name}
                      onPreview={() => preview(name)}
                    />
                    <Button
                      variant="link"
                      className="upgrade-plan-keep"
                      onClick={() => unkeep(name)}
                    >
                      Let the plan cut it
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
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
                  <div className="upgrade-plan-row-main">
                    <DeckCardRow
                      as="div"
                      change={c}
                      commanderName={commanderName}
                      peekName={c.name}
                      onPreview={() => preview(c.name)}
                    />
                  </div>
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
          variant="quiet"
          label="Close"
          icon={<X width={20} height={20} strokeWidth={1.8} />}
          onClick={onClose}
        />
      </div>
      <div className="upgrade-plan-panes" {...hoverPeek.listHandlers} {...touchPeek.listHandlers}>
        <div className="upgrade-plan-side">
          {wide ? (
            controls
          ) : (
            <Disclosure
              title="Settings"
              summary={`${budgetLabel} · ${goalLabel} · ${ownedFree ? 'Cards I own' : 'Buy everything'}`}
            >
              {controls}
            </Disclosure>
          )}
          {!loading && summary}
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
            <CopyButton
              value={buildShoppingListText}
              what="the list"
              label="Copy shopping list"
              variant="secondary"
              disabled={!ready || toBuy.length === 0}
            />
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
                onClick: () => void copyListFromMenu(),
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
      {/* The peeks sit above the sheet: DeckHoverPeek's own layer is
          --z-panel, which a modal covers. */}
      {hoverPeek.peek &&
        peekUrl &&
        createPortal(
          <div className="upgrade-plan-peek-layer">
            <DeckHoverPeek
              imageUrl={peekUrl}
              left={hoverPeek.peek.left}
              top={hoverPeek.peek.top}
              width={hoverPeek.peek.width}
            />
          </div>,
          document.body
        )}
      {touchPeek.peek &&
        createPortal(
          <div className="upgrade-plan-peek-layer">
            <DeckHoverPeek
              variant="touch"
              imageUrl={touchPeekUrl}
              left={touchPeek.peek.left}
              top={touchPeek.peek.top}
              width={touchPeek.peek.width}
            />
          </div>,
          document.body
        )}
      {carousel.preview}
    </Modal>
  );
}
