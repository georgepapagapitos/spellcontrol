import { useEffect, useRef, useState } from 'react';
import { useCardThumb } from '@/lib/card-thumbs';
import { ProgressBar } from '../ProgressBar';
import './GenerationTakeover.css';

interface Props {
  commanderName?: string;
  commanderImageUrl?: string;
  message: string;
  percent: number;
  isExiting?: boolean;
  onExitComplete?: () => void;
}

// Flavor lines keyed by substring match against real generator messages.
// First matching key wins; FALLBACK_LINES catches anything unrecognised.
const FLAVOR_LINES: [string, string[]][] = [
  [
    'Reshuffling',
    [
      'The order of things shifts…',
      'A new arrangement takes shape…',
      'Fortune favors the prepared.',
    ],
  ],
  [
    'Your library takes shape',
    [
      'Each card finds its purpose…',
      'The tome assembles itself…',
      'A hundred choices, one grimoire.',
    ],
  ],
  [
    'Shuffling up',
    [
      'Randomness is just order unseen…',
      'The deck breathes and stirs…',
      'Chaos resolves into strategy.',
    ],
  ],
  [
    'Studying the cards',
    ['Weighing every possibility…', 'The oracle reads between the lines…', 'Knowledge is mana.'],
  ],
  [
    'Adding your picks',
    [
      'Your favorites take their place…',
      'The chosen few step forward…',
      'Preference shapes destiny.',
    ],
  ],
  [
    'Consulting the Oracle',
    [
      'The Oracle speaks in riddles…',
      'Ancient wisdom flows freely…',
      "Minamo's waters hold the answer.",
      'Even seers must pause to think.',
    ],
  ],
  [
    'Attuning to',
    ['Mana flows toward its master…', 'The planes resonate…', 'Identity crystallises from chaos.'],
  ],
  [
    'Your commander heeds the call',
    [
      'The general rallies the troops…',
      'Command is a burden and a gift.',
      'Even legends need an army.',
    ],
  ],
  [
    'Scrying for more',
    [
      'The future is murky but close…',
      'Two cards shown; one must fall.',
      'Sight is power in the right hands.',
    ],
  ],
  [
    'Searching your library',
    ['Every tome holds a secret…', 'The answer is in there somewhere.', 'Tutors never come cheap.'],
  ],
  [
    'Scrying the multiverse',
    [
      'A thousand planes, one perfect fit…',
      'The Blind Eternities shimmer…',
      'Distance means nothing to a Planeswalker.',
    ],
  ],
  [
    'Summoning creatures',
    [
      'The creature pool stirs…',
      'Mana pulses through the ranks…',
      'Beasts and heroes heed the call.',
      'Every army begins with one.',
    ],
  ],
  [
    'Readying instants',
    [
      'Hold mana open just in case…',
      'Speed is its own kind of power.',
      'The best spells surprise everyone.',
    ],
  ],
  [
    'Inscribing sorceries',
    [
      'Words of power take form…',
      'The ritual requires preparation.',
      'Some spells are worth the wait.',
    ],
  ],
  [
    'Forging artifacts',
    ['Metal and magic intertwine…', 'Every artificer leaves a mark.', 'The workshop never sleeps.'],
  ],
  [
    'Weaving enchantments',
    [
      'Threads of magic bind the field…',
      'The aura settles like a second skin.',
      'Permanence is its own strength.',
    ],
  ],
  [
    'Calling planeswalkers',
    [
      'The sparks answer your summons…',
      'Across the planes they come.',
      'Loyalty is earned, never given.',
    ],
  ],
  [
    'Tapping the mana base',
    [
      'The land speaks its colors…',
      'Mana weaves across the planes…',
      'A solid foundation wins wars.',
      'Every source must answer the call.',
    ],
  ],
  [
    'Ramping up',
    [
      'The treasury fills with potential…',
      'More mana, more possibilities.',
      'Early ramp shapes the whole game.',
    ],
  ],
  [
    'Drawing cards',
    [
      'The hand reaches for one more…',
      'Card advantage is the oldest truth.',
      'Wheel of Fortune never lies.',
    ],
  ],
  [
    'Sharpening removal',
    [
      'Every threat deserves an answer…',
      'The exile zone grows ever larger.',
      'Nothing lasts forever in Commander.',
    ],
  ],
  [
    'Preparing board wipes',
    [
      'The board holds its breath…',
      'Wrath of God, Damnation, Cyclonic Rift…',
      'Sometimes equality means starting over.',
      'The cleanest solution is a blank slate.',
    ],
  ],
];

const FALLBACK_LINES = [
  'Consulting ancient tomes…',
  'The multiverse stirs…',
  'Magic takes its time.',
  'A worthy deck demands patience.',
];

// Macro build outline shown as a checklist below the hero, lit progressively
// by `percent`. Coarse on purpose — the hero's live `message` carries the
// precise step; this is the at-a-glance map of where the build is.
// ponytail: percent-threshold mapping (monotonic across both the EDHREC and
// Scryfall-fallback paths). If the paths' pacing ever diverges enough to
// mislabel a stage, thread a real phase id through `onProgress` instead.
const MILESTONES: { at: number; label: string }[] = [
  { at: 0, label: 'Consulting the Oracle' },
  { at: 18, label: 'Scrying the multiverse' },
  { at: 35, label: 'Summoning creatures' },
  { at: 45, label: 'Weaving the spells' },
  { at: 78, label: 'Tapping the mana base' },
  { at: 95, label: 'Shuffling up' },
];

/** Index of the in-progress milestone for a given percent (highest passed). */
function currentMilestone(percent: number): number {
  return MILESTONES.reduce((acc, m, i) => (percent >= m.at ? i : acc), 0);
}

function getFlavorLines(message: string): string[] {
  for (const [key, lines] of FLAVOR_LINES) {
    if (message.includes(key)) return lines;
  }
  return FALLBACK_LINES;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Full-page takeover shown while commander-deck generation is running.
 * Replaces the small inline progress strip so the build event feels
 * deliberate — commander art anchors the wait and keeps the user oriented.
 *
 * Reduced-motion safe: the fade-in and art overlay are CSS-only and
 * gated with prefers-reduced-motion. No new keyframes — reuses the
 * shared `fade-in` from styles/footer-card-preview.css.
 */
export function GenerationTakeover({
  commanderName,
  commanderImageUrl,
  message,
  percent,
  isExiting = false,
  onExitComplete,
}: Props) {
  // Resolve from CDN if we only have a name; direct URL wins immediately.
  const resolvedThumb = useCardThumb(commanderImageUrl ? undefined : commanderName, 'normal');
  const artUrl = commanderImageUrl ?? resolvedThumb;

  const [flavorIndex, setFlavorIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevMessageRef = useRef(message);

  // Rotating timer — also resets when the generator phase changes.
  // Only runs when reduced motion is not requested.
  useEffect(() => {
    // Clear any in-flight timer before setting up a new one.
    if (timerRef.current !== null) clearTimeout(timerRef.current);

    // If the message changed, reset to the first flavor line immediately.
    if (prevMessageRef.current !== message) {
      prevMessageRef.current = message;
      setFlavorIndex(0);
      setVisible(true);
      if (prefersReducedMotion()) return;
    } else if (prefersReducedMotion()) {
      return;
    }

    const lines = getFlavorLines(message);

    // ~3.4s total: 3140ms visible + 260ms fade-out
    timerRef.current = setTimeout(() => {
      setVisible(false);
      // After fade-out completes, advance index and fade back in.
      timerRef.current = setTimeout(() => {
        setFlavorIndex((i) => (i + 1) % lines.length);
        setVisible(true);
      }, 260);
    }, 3140);

    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [message, flavorIndex]);

  const flavorLines = getFlavorLines(message);
  const flavorText = flavorLines[flavorIndex % flavorLines.length];
  const activeMilestone = currentMilestone(percent);

  const handleAnimationEnd = (e: React.AnimationEvent<HTMLDivElement>) => {
    if (isExiting && e.animationName === 'gen-takeover-exit') onExitComplete?.();
  };

  return (
    <div
      className={`gen-takeover${isExiting ? ' is-exiting' : ''}`}
      role="status"
      aria-live="polite"
      aria-label="Building deck…"
      onAnimationEnd={handleAnimationEnd}
    >
      <div className="gen-takeover-hero">
        {artUrl && (
          <div className="gen-takeover-art" aria-hidden>
            <img src={artUrl} alt="" className="gen-takeover-art-img" />
            <div className="gen-takeover-art-fade" aria-hidden />
          </div>
        )}
        <div className="gen-takeover-body">
          {commanderName && (
            <p className="gen-takeover-commander" aria-hidden>
              {commanderName}
            </p>
          )}
          <p className="gen-takeover-step">{message}</p>
          <p
            className={`gen-takeover-flavor${visible ? '' : ' gen-takeover-flavor--hidden'}`}
            aria-hidden="true"
          >
            {flavorText}
          </p>
          <ProgressBar percent={percent} className="gen-takeover-bar" />
        </div>
      </div>
      {/* Macro outline — aria-hidden; the live region above already
          announces the precise current step. */}
      <ol className="gen-takeover-phases" aria-hidden>
        {MILESTONES.map((m, i) => {
          const state =
            i < activeMilestone ? 'done' : i === activeMilestone ? 'current' : 'upcoming';
          return (
            <li key={m.label} className={`gen-takeover-phase gen-takeover-phase--${state}`}>
              <span className="gen-takeover-phase-mark" aria-hidden />
              <span className="gen-takeover-phase-label">{m.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
