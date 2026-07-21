import './CommanderPopularityStat.css';
import type { JSX } from 'react';
import { InfoTip } from '@/components/InfoTip';

export interface CommanderPopularityStatProps {
  /** EDHREC's own sample size for this commander (its `numDecks`). */
  edhrecNumDecks: number;
  /** SpellControl's own platform deck count. `null` = below MIN_COMMANDER_DECKS
   *  (the API's 404) — render EDHREC-only, never "0". */
  ownCount: number | null;
  /** Suppresses render entirely — a sub-100ms fetch of a tiny payload, so no
   *  skeleton (would flash-then-settle more distractingly than a brief absence
   *  on this secondary line). */
  loading: boolean;
  /** `card` mounts the InfoTip explainer (room for a trigger); `inline` rows
   *  don't. */
  variant: 'inline' | 'card';
}

/**
 * Blended "N decks on SpellControl" popularity stat — EDHREC's global sample
 * size always shown when known, SpellControl's own threshold-gated count
 * blended in once it clears the platform's minimum-sample floor (the API
 * already enforces the threshold: a below-threshold commander 404s, so
 * `ownCount` is simply `null` here, never a suppressed small number).
 *
 * Mounted at `variant="card"` in DeckIdentityCard (a new stat line — this
 * component's the first place a commander-popularity number renders there).
 * CardSearchPanel's per-row "on SpellControl" fragment is a different metric
 * (card-inclusion count, not commander deckCount) appended directly inside
 * its own FitSignal — see that file — rather than mounting this component;
 * `variant="inline"` stays fully implemented and tested here for contract
 * completeness / future reuse.
 */
export function CommanderPopularityStat({
  edhrecNumDecks,
  ownCount,
  loading,
  variant,
}: CommanderPopularityStatProps): JSX.Element | null {
  if (loading) return null;
  if (edhrecNumDecks === 0 && ownCount === null) return null;

  if (ownCount === null) {
    return (
      <p className="commander-popularity-stat">{edhrecNumDecks.toLocaleString()} decks on EDHREC</p>
    );
  }

  return (
    <p className="commander-popularity-stat">
      {ownCount.toLocaleString()} on SpellControl · {edhrecNumDecks.toLocaleString()} on EDHREC
      {variant === 'card' && (
        <InfoTip
          label="platform decks"
          text="Decks built and published on SpellControl with this commander — updates nightly."
        />
      )}
    </p>
  );
}
