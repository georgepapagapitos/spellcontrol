import type { ScryfallCard } from '@/deck-builder/types';
import type { Finish } from '../types';
import { haptics } from './haptics';

/**
 * Value tier for a freshly-scanned card. Drives both the celebratory sound
 * and the haptic intensity — higher tier = beefier feedback. Tiers are USD
 * price bands; missing/non-numeric prices fall to tier 0. We check `usd`
 * first, then `usd_foil` as a fallback (a non-foil-printed-only card with
 * an `usd_foil` value still gets a fair tier).
 */
export type CardValueTier = 0 | 1 | 2 | 3;

export function priceTier(card: Pick<ScryfallCard, 'prices'> | null | undefined): CardValueTier {
  if (!card) return 0;
  const raw = card.prices?.usd ?? card.prices?.usd_foil ?? card.prices?.usd_etched ?? null;
  if (raw == null) return 0;
  const usd = Number.parseFloat(raw);
  if (!Number.isFinite(usd)) return 0;
  if (usd >= 20) return 3;
  if (usd >= 5) return 2;
  if (usd >= 1) return 1;
  return 0;
}

/** Human-facing label for each tracked finish. */
export const FINISH_LABELS: Record<Finish, string> = {
  nonfoil: 'Normal',
  foil: 'Foil',
  etched: 'Etched',
};

/**
 * The finishes a printing is actually available in, in display order,
 * restricted to the ones we track. Falls back to `['nonfoil']` when Scryfall
 * gives us nothing usable — so the toggle is only interactive (length > 1)
 * for cards that genuinely have a foil/etched variant.
 */
export function availableFinishes(finishes: string[] | null | undefined): Finish[] {
  const known: Finish[] = ['nonfoil', 'foil', 'etched'];
  const present = known.filter((f) => finishes?.includes(f));
  return present.length > 0 ? present : ['nonfoil'];
}

/** Next finish when cycling the toggle, wrapping around the available set. */
export function nextFinish(current: Finish, available: Finish[]): Finish {
  if (available.length <= 1) return current;
  const i = available.indexOf(current);
  return available[(i + 1) % available.length];
}

/**
 * USD unit price for a given finish, falling back across finishes when the
 * preferred one is missing (Scryfall often omits one). Returns null if no
 * usable numeric price exists. Used for both the running total and the
 * per-card amount shown on the scanner panel, so they stay consistent.
 */
export function finishUnitPrice(
  prices: ScryfallCard['prices'] | null | undefined,
  finish: Finish
): number | null {
  if (!prices) return null;
  const order =
    finish === 'foil'
      ? [prices.usd_foil, prices.usd, prices.usd_etched]
      : finish === 'etched'
        ? [prices.usd_etched, prices.usd_foil, prices.usd]
        : [prices.usd, prices.usd_foil, prices.usd_etched];
  for (const raw of order) {
    if (raw == null) continue;
    const v = Number.parseFloat(raw);
    if (Number.isFinite(v)) return v;
  }
  return null;
}

/**
 * Renders a tier-appropriate "card landed" cue: a synthesized WebAudio
 * flourish + a haptic pulse. Cheap (no audio assets to ship) and always
 * fire-and-forget — any failure is silently swallowed.
 */
let audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (audioCtx) return audioCtx;
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
    return audioCtx;
  } catch {
    return null;
  }
}

interface NoteOpts {
  freq: number;
  startOffset: number; // seconds after `now`
  duration: number; // seconds
  type?: OscillatorType;
  peakGain?: number;
}

function playNote(ctx: AudioContext, now: number, opts: NoteOpts): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(opts.freq, now + opts.startOffset);
  const peak = opts.peakGain ?? 0.18;
  gain.gain.setValueAtTime(0.0001, now + opts.startOffset);
  gain.gain.exponentialRampToValueAtTime(peak, now + opts.startOffset + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + opts.startOffset + opts.duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now + opts.startOffset);
  osc.stop(now + opts.startOffset + opts.duration + 0.02);
}

/**
 * Plays a flourish whose richness scales with `tier`:
 *   0: short ding (the original beep) — common card
 *   1: two-note "nice" — couple-bucks card
 *   2: ascending arpeggio — chase-y card ($5–$20)
 *   3: chord + bell + sparkle sweep — jackpot ($20+)
 */
export function playValueChime(tier: CardValueTier): void {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  try {
    if (tier === 0) {
      playNote(ctx, now, { freq: 880, startOffset: 0, duration: 0.16, type: 'sine' });
      return;
    }
    if (tier === 1) {
      // Major third — pleasant, low-key.
      playNote(ctx, now, { freq: 880, startOffset: 0, duration: 0.22, type: 'sine' });
      playNote(ctx, now, { freq: 1108.73, startOffset: 0.04, duration: 0.22, type: 'sine' });
      return;
    }
    if (tier === 2) {
      // Quick I–III–V arpeggio in A.
      playNote(ctx, now, { freq: 880, startOffset: 0, duration: 0.14, type: 'triangle' });
      playNote(ctx, now, { freq: 1108.73, startOffset: 0.08, duration: 0.14, type: 'triangle' });
      playNote(ctx, now, {
        freq: 1318.51,
        startOffset: 0.16,
        duration: 0.22,
        type: 'triangle',
        peakGain: 0.22,
      });
      return;
    }
    // tier 3 — chord + bell harmonic + a glassy sweep.
    playNote(ctx, now, { freq: 523.25, startOffset: 0, duration: 0.55, type: 'sine' });
    playNote(ctx, now, { freq: 659.25, startOffset: 0.02, duration: 0.55, type: 'sine' });
    playNote(ctx, now, { freq: 783.99, startOffset: 0.04, duration: 0.55, type: 'sine' });
    playNote(ctx, now, {
      freq: 1567.98,
      startOffset: 0.06,
      duration: 0.45,
      type: 'sine',
      peakGain: 0.1,
    });
    // Sparkle — a high triangle that rises sharply, evoking a bell shimmer.
    const sparkle = ctx.createOscillator();
    const sgain = ctx.createGain();
    sparkle.type = 'triangle';
    sparkle.frequency.setValueAtTime(1760, now + 0.18);
    sparkle.frequency.exponentialRampToValueAtTime(3520, now + 0.45);
    sgain.gain.setValueAtTime(0.0001, now + 0.18);
    sgain.gain.exponentialRampToValueAtTime(0.08, now + 0.22);
    sgain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    sparkle.connect(sgain);
    sgain.connect(ctx.destination);
    sparkle.start(now + 0.18);
    sparkle.stop(now + 0.55);
  } catch {
    // Audio is best-effort.
  }
}

/**
 * Tier-matched haptic. Light cards get a tap, mid-tier success notification,
 * and the jackpot tier gets the heavy-impact cue normally reserved for
 * "player went to lethal" — felt clearly through a phone in hand.
 */
export function pulseValueHaptic(tier: CardValueTier): void {
  if (tier >= 3) haptics.lethal();
  else if (tier >= 1) haptics.success();
  else haptics.tap();
}
