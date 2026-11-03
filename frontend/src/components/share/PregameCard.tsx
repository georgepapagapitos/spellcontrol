import './PregameCard.css';
import { useMemo, type JSX } from 'react';
import { ChevronDown, Share2 } from 'lucide-react';
import { readSpeed } from '@spellcontrol/deck-metrics';
import type { Deck } from '@/store/decks';
import type { ClockCard } from '@/lib/mana-sim/opening-hand-sim';
import { speedPathOf } from '@/lib/mana-sim/speed-path';
import { useAssemblyClock } from '@/lib/mana-sim/use-assembly-clock';
import { pregameShareText, pregameSpeed } from '@/lib/deck-analysis/pregame-card';
import { canShare, openShareSheet } from '@/lib/util/web-share';
import { buttonClass } from '@/components/shared/Button';
import { OverflowMenu, type OverflowMenuItem } from '@/components/overlays/OverflowMenu';
import { copyToClipboard } from '@/lib/util/clipboard';
import { toast } from '@/store/toasts';

interface PregameCardProps {
  deck: Deck;
  /** Mainboard, one entry per copy: what the assembly clock draws from. */
  library: readonly ClockCard[];
  /** The bracket the card is read against (stated, else estimated). */
  bracket: number;
  /** The bracket as the hero words it: "Bracket 3", "Bracket 3+". */
  bracketText: string;
  /** Commander art crop, when the deck has one. */
  art?: string;
  /** The page's own address, shared as is. */
  url: string;
}

/**
 * The pregame card: what a pod wants to know about a deck before the first
 * shuffle, in one block that can be shared. Bracket, Game Changers, and how
 * often the win path comes together before the turn Wizards' October 2025
 * update says the bracket's games last to. The speed row is an estimate from a
 * goldfish simulation, so the sample size always rides with it.
 */
/** A menu row's copy confirms with a toast, since the menu closes on use
 *  (STYLE_GUIDE § Verbs, Copy). */
function copyRow(label: string, what: string, value: string) {
  return {
    label,
    onClick: () => {
      void copyToClipboard(value).then((ok) =>
        toast.show(
          ok
            ? { message: `Copied ${what}`, tone: 'success' }
            : { message: `Couldn't copy ${what}.`, tone: 'error' }
        )
      );
    },
  } satisfies OverflowMenuItem;
}

export function PregameCard({
  deck,
  library,
  bracket,
  bracketText,
  art,
  url,
}: PregameCardProps): JSX.Element {
  const path = useMemo(() => speedPathOf(deck.winConditions), [deck.winConditions]);
  const { clock, pending } = useAssemblyClock(library, path?.assembly ?? null, {
    iterations: 1000,
    wildcards: path?.tutors ? [...path.tutors] : undefined,
  });
  const reading = readSpeed(clock, bracket);
  const speed = reading ? pregameSpeed(reading) : null;
  const gameChangers = deck.bracketEstimation?.breakdown?.gameChangerCount ?? null;
  const commander = deck.commander?.name;
  const text = pregameShareText({
    deckName: deck.name,
    bracketText,
    gameChangers,
    speed: reading,
    url,
  });

  return (
    <div className="pregame-card-frame">
      <section className="pregame-card" aria-labelledby="pregame-card-title">
        {art && (
          <img
            className="pregame-card-art"
            src={art}
            alt=""
            width={120}
            height={88}
            loading="lazy"
          />
        )}
        <div className="pregame-card-body">
          <h2 className="pregame-card-title" id="pregame-card-title">
            Before you sit down
          </h2>
          {commander && <p className="pregame-card-commander">{commander}</p>}
          <dl className="pregame-card-facts" aria-busy={pending}>
            <div className="pregame-card-fact">
              <dt>Bracket</dt>
              <dd>{bracketText.replace(/^Bracket\s+/, '')}</dd>
            </div>
            {gameChangers !== null && (
              <div className="pregame-card-fact">
                <dt>Game Changers</dt>
                <dd>{gameChangers}</dd>
              </div>
            )}
            <div className="pregame-card-fact pregame-card-fact--speed">
              <dt>Speed</dt>
              {pending ? (
                <dd className="pregame-card-sub">Running the speed read</dd>
              ) : speed ? (
                <>
                  <dd>
                    {speed.when}: {speed.value}
                  </dd>
                  <dd className="pregame-card-sub">
                    {speed.band}. From {speed.sample}.
                  </dd>
                </>
              ) : (
                <dd className="pregame-card-sub">No combo or alternate win path to time.</dd>
              )}
            </div>
          </dl>
          {/* One Share button: the native sheet where the browser has one, then
              Copy summary and Copy link. Three buttons wrapped Copy link alone
              onto a second row at phone width. */}
          <div className="pregame-card-actions">
            <OverflowMenu
              ariaLabel="Share this deck"
              align="left"
              triggerClassName={buttonClass({ variant: 'primary' })}
              trigger={
                <>
                  <Share2 width={16} height={16} strokeWidth={2} aria-hidden />
                  Share
                  <ChevronDown width={14} height={14} strokeWidth={1.8} aria-hidden />
                </>
              }
              items={[
                ...(canShare()
                  ? [
                      {
                        label: 'Share…',
                        icon: Share2,
                        onClick: () => void openShareSheet({ title: deck.name, text, url }),
                      },
                    ]
                  : []),
                copyRow('Copy summary', 'the summary', text),
                copyRow('Copy link', 'the link', url),
              ]}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
