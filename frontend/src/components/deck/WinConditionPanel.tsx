import { useMemo, type JSX } from 'react';
import './WinConditionPanel.css';
import { AlertTriangle, Hourglass, Tag, Trophy } from 'lucide-react';
import type {
  WinConCategory,
  WinConditionAnalysis,
  WinCondition,
} from '@/deck-builder/services/winConditions/types';
import { tagOnlyWinCons } from '@/deck-builder/services/winConditions/winConTags';
import { simulateAssemblyClock, type ClockCard } from '@/lib/opening-hand-sim';
import { InfoTip } from '../InfoTip';
import { useCardCarousel, type CarouselEntry } from './useCardCarousel';

export interface WinConditionPanelProps {
  analysis: WinConditionAnalysis;
  /**
   * Mainboard cards (one entry per physical copy, commanders excluded) — feeds
   * the assembly clock on the primary path, which needs each card's mana value
   * and land/ramp classification, not just its name. Omit to hide the clock.
   */
  library?: readonly ClockCard[];
  /**
   * Card names the user has manually tagged as a win condition (E125) —
   * display-only cross-link with the engine's own evidence, never fed back
   * into detection. A name already surfaced as engine evidence gets a
   * "tagged by you" mark on that existing row instead of a duplicate entry;
   * anything else renders in its own small section. Absent/empty = no tags.
   */
  winConTags?: readonly string[];
  /**
   * Toggle a card's Wincon tag (fired only from a direct click — never
   * automatic). Omit to render every evidence chip read-only.
   */
  onToggleWinConTag?: (cardName: string) => void;
}

/**
 * A path whose assembly IS the kill — the pieces resolving ends the game, so
 * the clock is a real kill turn. **This now gates whether the clock renders at
 * all**, not just its wording.
 *
 * Why: for a strategic mass (aristocrats / go-wide / poison / voltron),
 * "assembled" means `STRATEGIC_MIN_CARDS` of the evidence pool have been cast —
 * a *detector qualification* bar, not a "your plan is working" bar. Measured
 * over 19 real EDHREC average decks, the resulting turn is very nearly a pure
 * function of pool SIZE rather than deck speed:
 *
 *   pool 19-20 cards → t4-t9    (Atraxa poison t4, Ghired t9, Meren t8)
 *   pool 11-12 cards → t10-t24  (Muldrotha t10, Prosper t16, Winota t24)
 *   pool 5-6 cards   → t36-t42  (Tergrid t37, Godo t36, Miirym t41)
 *
 * Miirym reading "go-wide online by turn 41" — a deck that copies dragon tokens
 * every turn — is the tell: it has a 5-card go-wide evidence pool, and the
 * number was reporting that, dressed as a turn. Kill-category clocks over the
 * same corpus are coherent and track power (Najeela t3 · Kinnan/Urza t8 ·
 * Kaalia t10 · Korvold t11 · Edgar t14 · Krenko t15 · Lathril t23), so those
 * still show. Strategic paths keep their row and evidence, just no clock line.
 *
 * Restoring a number for strategic paths means defining a real per-category
 * "online" bar (10 poison counters, a payoff plus N bodies) — a modelling job
 * with no ground truth to validate against, deliberately not attempted here.
 */
export function isKillClock(category: WinConCategory): boolean {
  return category === 'infinite-combo' || category === 'alt-win';
}

/**
 * Shared methodology explainer for the kill-turn clock — one ⓘ per concept
 * (STYLE_GUIDE Info tooltips); also used by DeckTestHandPanel's and the
 * playtest stats sheet's clock lines. Only ever rendered next to a kill-category
 * clock (see {@link isKillClock}), so it can speak plainly about winning.
 */
export function assemblyClockTip(): JSX.Element {
  return (
    <>
      <span className="info-tip-lead">
        Across 1,000 simulated games: mulligan to a keepable seven, then each turn draw, make a land
        drop, and spend that turn&apos;s mana — ramp, card draw, tutors and win-path pieces. The
        clock stops when the path is fully cast: every piece of one combo, or an alt-win card. A
        tutor costs its mana and fetches to hand, so what it finds still has to be cast.
      </span>
      <span className="info-tip-lead">
        This path wins on resolution, so that turn is the kill turn. Colors, rituals and opponents
        aren&apos;t modeled, and every draw spell counts as two cards: it&apos;s a goldfish
        estimate, not a promise.
      </span>
    </>
  );
}

/**
 * One evidence chip: tap the name to preview the card; tap the trailing Tag
 * glyph to mark/unmark it as a win condition (E125, user-confirmed — the
 * click IS the confirmation, nothing tags itself). `onToggleTag` absent
 * renders the chip name-preview only, no tag control.
 */
function WinConEvidenceItem({
  name,
  tagged,
  onTap,
  onToggleTag,
}: {
  name: string;
  tagged: boolean;
  onTap: () => void;
  onToggleTag?: (name: string) => void;
}): JSX.Element {
  return (
    <li className="win-con-evidence-item">
      <button
        type="button"
        className="win-con-evidence-button"
        onClick={onTap}
        aria-label={`Preview ${name}`}
      >
        <span className="card-name-chip-text" title={name}>
          {name}
        </span>
      </button>
      {onToggleTag && (
        <button
          type="button"
          className="win-con-evidence-tag-btn"
          aria-pressed={tagged}
          aria-label={tagged ? `Untag ${name} as Wincon` : `Tag ${name} as Wincon`}
          title={tagged ? 'Tagged by you as a win condition' : 'Tag as Wincon'}
          onClick={() => onToggleTag(name)}
        >
          <Tag
            width={13}
            height={13}
            strokeWidth={2}
            fill={tagged ? 'currentColor' : 'none'}
            aria-hidden
          />
        </button>
      )}
    </li>
  );
}

function WinConRow({
  wincon,
  primary,
  taggedNames,
  onToggleTag,
  onTapCard,
}: {
  wincon: WinCondition;
  primary: boolean;
  taggedNames: Set<string>;
  onToggleTag?: (name: string) => void;
  onTapCard: (entries: CarouselEntry[], tappedName: string) => void;
}): JSX.Element {
  const entries = wincon.evidence.map((name) => ({ name, label: wincon.label }));

  return (
    <div className={`win-con-row${primary ? ' win-con-row--primary' : ''}`}>
      <div className="win-con-row-head">
        {primary && <Trophy className="win-con-trophy" width={13} height={13} aria-hidden />}
        <span className="win-con-label">{wincon.label}</span>
        {primary && <span className="win-con-tag">Primary</span>}
      </div>
      <p className="win-con-summary">{wincon.summary}</p>
      {wincon.evidence.length > 0 && (
        <ul className="win-con-evidence" aria-label={`Evidence for ${wincon.label}`}>
          {wincon.evidence.map((name) => (
            <WinConEvidenceItem
              key={name}
              name={name}
              tagged={taggedNames.has(name)}
              onTap={() => void onTapCard(entries, name)}
              onToggleTag={onToggleTag}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Power-tab panel: how a commander deck wins (primary + secondary paths).
 * Mirrors EnginePanel structure — headline, per-path rows, no-clear-wincon
 * fallback message.
 */
export function WinConditionPanel({
  analysis,
  library,
  winConTags,
  onToggleWinConTag,
}: WinConditionPanelProps): JSX.Element {
  const carousel = useCardCarousel('Win conditions');

  // "Typically kills by turn N" for the primary path. Null (→ hidden) when the
  // path isn't a kill category, the analysis predates the assembly field, the
  // path has no discrete assembly (generic combat), or the deck no longer
  // holds the pieces.
  const clock = useMemo(() => {
    const primary = analysis.primary;
    // Kill categories only — a strategic mass's "assembled" turn measures its
    // evidence-pool size, not its speed (see isKillClock).
    if (!primary || !isKillClock(primary.category)) return null;
    if (!primary.assembly?.length || !library?.length) return null;
    return simulateAssemblyClock(library, primary.assembly, {
      iterations: 1000,
      wildcards: analysis.tutors,
    });
  }, [analysis, library]);

  const taggedNames = useMemo(() => new Set(winConTags ?? []), [winConTags]);
  // Names the engine already lists as evidence get their mark on that row
  // instead (WinConEvidenceItem) — this is only the leftover tags, so one
  // never silently vanishes when the live analysis moves on without it.
  const tagOnly = useMemo(() => tagOnlyWinCons(analysis, winConTags ?? []), [analysis, winConTags]);
  const tagOnlyEntries = tagOnly.map((name) => ({ name, label: 'Tagged by you' }));

  // Dashed border reads "you said so", not "the engine found this" — same
  // box weight as a backup path, deliberately not accent-styled like the
  // primary pick so it can't be mistaken for a second detected path.
  const taggedSection = tagOnly.length > 0 && (
    <div className="win-con-row win-con-row--tagged">
      <div className="win-con-row-head">
        <Tag className="win-con-tagged-icon" width={13} height={13} aria-hidden />
        <span className="win-con-label">Tagged by you</span>
      </div>
      <p className="win-con-summary">
        {tagOnly.length} card{tagOnly.length === 1 ? '' : 's'} you've marked as a win condition
      </p>
      <ul className="win-con-evidence" aria-label="Cards tagged by you">
        {tagOnly.map((name) => (
          <WinConEvidenceItem
            key={name}
            name={name}
            tagged
            onTap={() => void carousel.open(tagOnlyEntries, name)}
            onToggleTag={onToggleWinConTag}
          />
        ))}
      </ul>
    </div>
  );

  if (analysis.noClearWinCondition) {
    return (
      <section className="win-con-panel" aria-label="Win condition analysis">
        <p className="win-con-headline win-con-headline--warn">
          <AlertTriangle className="win-con-warn-icon" width={14} height={14} aria-hidden />
          No clear win condition detected
        </p>
        <p className="win-con-empty">
          The deck doesn't have a dominant path to victory. Consider adding combo pieces, a damage
          plan, or building around a synergy strategy.
        </p>
        {taggedSection}
        {carousel.preview}
      </section>
    );
  }

  return (
    <section className="win-con-panel" aria-label="Win condition analysis">
      {analysis.primary && (
        <WinConRow
          wincon={analysis.primary}
          primary
          taggedNames={taggedNames}
          onToggleTag={onToggleWinConTag}
          onTapCard={carousel.open}
        />
      )}
      {clock && (
        <p className="win-con-clock">
          <Hourglass className="win-con-clock-icon" width={13} height={13} aria-hidden />
          <span>
            Typically kills by turn <strong>{clock.typicalTurn}</strong>
            <span className="win-con-clock-sub">
              {' '}
              · 90% of games by turn {clock.p90Turn}, across 1,000 simulated games
            </span>
          </span>
          <InfoTip
            label="the kill-turn estimate"
            className="win-con-clock-tip"
            text={assemblyClockTip()}
          />
        </p>
      )}
      {analysis.secondary.length > 0 && (
        <>
          <h3 className="win-con-secondary-title">Backup paths</h3>
          {analysis.secondary.map((wc) => (
            <WinConRow
              key={wc.category}
              wincon={wc}
              primary={false}
              taggedNames={taggedNames}
              onToggleTag={onToggleWinConTag}
              onTapCard={carousel.open}
            />
          ))}
        </>
      )}
      {taggedSection}
      {carousel.preview}
    </section>
  );
}
