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
 * the clock reads as a kill turn. Every other category (voltron's equipment
 * mass, go-wide, mill) still has to connect after it comes online, so those
 * keep the weaker "online by" reading.
 */
export function isKillClock(category: WinConCategory): boolean {
  return category === 'infinite-combo' || category === 'alt-win';
}

/**
 * Shared methodology explainer for the assembly clock — one ⓘ per concept
 * (STYLE_GUIDE Info tooltips); also used by DeckTestHandPanel's and the
 * playtest stats sheet's clock lines. `kill` matches {@link isKillClock} so the
 * last line doesn't over- or under-claim what the number means.
 */
export function assemblyClockTip(kill: boolean): JSX.Element {
  return (
    <>
      <span className="info-tip-lead">
        Across 1,000 simulated games: mulligan to a keepable seven, then each turn draw, make a land
        drop, and spend that turn&apos;s mana — ramp, card draw, tutors and win-path pieces. The
        clock stops when one path is fully cast: every piece of one combo, any one alt-win card, or
        a critical mass of a strategic plan. A tutor costs its mana and fetches to hand, so what it
        finds still has to be cast.
      </span>
      <span className="info-tip-lead">
        {kill
          ? 'This path wins on resolution, so that turn is the kill turn.'
          : 'Online isn’t the same as won — this path still has to connect afterwards.'}{' '}
        Colors, rituals and opponents aren&apos;t modeled, and every draw spell counts as two cards:
        it&apos;s a goldfish estimate, not a promise.
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

  // "Typically kills/online by turn N" for the primary path. Null (→ hidden)
  // when the analysis predates the assembly field, the path has no discrete
  // assembly (generic combat), or the deck no longer holds the pieces.
  const clock = useMemo(() => {
    const assembly = analysis.primary?.assembly;
    if (!assembly?.length || !library?.length) return null;
    return simulateAssemblyClock(library, assembly, {
      iterations: 1000,
      wildcards: analysis.tutors,
    });
  }, [analysis, library]);
  const kills = !!analysis.primary && isKillClock(analysis.primary.category);

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
            Typically {kills ? 'kills' : 'online'} by turn <strong>{clock.typicalTurn}</strong>
            <span className="win-con-clock-sub">
              {' '}
              · 90% of games by turn {clock.p90Turn}, across 1,000 simulated games
            </span>
          </span>
          <InfoTip
            label={kills ? 'the kill-turn estimate' : 'the assembly clock'}
            className="win-con-clock-tip"
            text={assemblyClockTip(kills)}
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
