import type { BattlefieldCard, PlaytestAction, PlaytestCard, PlaytestState } from '@/lib/playtest';
import { autoPlace } from '@/playtest/lib/auto-place';
import { displayPT } from '@/playtest/lib/power-toughness';
import { DEFAULT_WAVE_PATTERN, type HordeSettings } from './settings';

function isInstantOrSorcery(card: PlaytestCard): boolean {
  const t = (card.typeLine ?? '').toLowerCase();
  return t.includes('instant') || t.includes('sorcery');
}

function isCreature(card: PlaytestCard): boolean {
  return (card.typeLine ?? '').toLowerCase().includes('creature');
}

/** One reveal wave: cards off the top until (and including) the first
 *  nontoken card, or the rest of the library if it runs out first. */
function revealWave(remaining: readonly PlaytestCard[]): PlaytestCard[] {
  const out: PlaytestCard[] = [];
  for (const card of remaining) {
    out.push(card);
    if (!card.isToken) break;
  }
  return out;
}

/** Runs up to `count` waves back to back, stopping cleanly when the library
 *  empties. `waves` counts only waves that actually revealed something. */
function planWaves(
  library: readonly PlaytestCard[],
  count: number
): { revealed: PlaytestCard[]; waves: number } {
  const revealed: PlaytestCard[] = [];
  let index = 0;
  let waves = 0;
  for (let w = 0; w < count && index < library.length; w++) {
    const wave = revealWave(library.slice(index));
    revealed.push(...wave);
    index += wave.length;
    waves++;
  }
  return { revealed, waves };
}

/**
 * Decide what the horde reveals this turn. Pure: reads the library, returns
 * what would come off the top plus how many waves that took. `hordeTurn` is
 * 1-based (only `waves-pattern` uses it, to pick the turn's place in the
 * cycle). Stops cleanly at an empty library.
 */
export function planHordeTurn(
  library: readonly PlaytestCard[],
  settings: HordeSettings,
  hordeTurn: number,
  hordeArtifacts = 0
): { revealed: PlaytestCard[]; waves: number } {
  const mode = settings.reveal;
  switch (mode.kind) {
    case 'until-nontoken':
      return planWaves(library, 1);
    case 'waves':
      return planWaves(library, mode.perTurn);
    case 'waves-pattern': {
      const pattern = mode.pattern.length > 0 ? mode.pattern : DEFAULT_WAVE_PATTERN;
      const perTurn = pattern[(hordeTurn - 1) % pattern.length];
      return planWaves(library, perTurn);
    }
    case 'fixed': {
      const count = mode.count + (mode.plusPerArtifact ? hordeArtifacts : 0);
      const revealed = library.slice(0, Math.max(0, count));
      return { revealed, waves: revealed.length > 0 ? 1 : 0 };
    }
    default:
      return { revealed: [], waves: 0 };
  }
}

/**
 * Splits a turn's reveal into permanents (tokens, and nontoken cards that
 * aren't Instant/Sorcery) and spells to resolve. Permanents get a
 * `MOVE_TO_BATTLEFIELD` action placed via the board's own `autoPlace`, laid
 * out in sequence so they don't stack on each other. Instants/sorceries come
 * back as `toResolve` — the caller shows them, the player resolves the text,
 * then `resolveActions` sends them to the graveyard.
 */
export function hordeTurnActions(
  revealed: readonly PlaytestCard[],
  battlefield: readonly BattlefieldCard[]
): { toBattlefield: PlaytestAction[]; toResolve: PlaytestCard[] } {
  const toBattlefield: PlaytestAction[] = [];
  const toResolve: PlaytestCard[] = [];
  let simulated = battlefield;

  for (const card of revealed) {
    if (!card.isToken && isInstantOrSorcery(card)) {
      toResolve.push(card);
      continue;
    }
    const { x, y } = autoPlace(card, simulated);
    toBattlefield.push({ type: 'MOVE_TO_BATTLEFIELD', cardId: card.id, x, y });
    simulated = [
      ...simulated,
      { card, tapped: false, counters: {}, stickers: [], x, y, faceDown: false },
    ];
  }
  return { toBattlefield, toResolve };
}

/** Sends resolved instants/sorceries to the graveyard once the player has
 *  applied their text. */
export function resolveActions(toResolve: readonly PlaytestCard[]): PlaytestAction[] {
  return toResolve.map((card) => ({ type: 'MOVE_TO_ZONE', cardId: card.id, to: 'graveyard' }));
}

/** A group of identical attackers (same name, current P/T, same counters) —
 *  the only place a "×N" appears in the damage banner. */
export interface AttackerGroup {
  name: string;
  power: string;
  toughness: string;
  count: number;
}

/** Every creature the horde controls attacks. Power/toughness are the
 *  currently displayed values (modifiers and +1/+1 / -1/-1 counters via
 *  `displayPT`); `*` or any other unparsable power counts as 0 toward the
 *  total. */
export function attackSummary(battlefield: readonly BattlefieldCard[]): {
  attackers: number;
  power: number;
  groups: AttackerGroup[];
} {
  const creatures = battlefield.filter((b) => isCreature(b.card));
  let power = 0;
  const groups = new Map<string, AttackerGroup>();

  for (const bf of creatures) {
    const pt = displayPT(bf.card, bf);
    const powerStr = pt?.power ?? '0';
    const toughnessStr = pt?.toughness ?? '0';
    const numeric = Number(powerStr);
    power += Number.isFinite(numeric) ? numeric : 0;

    const key = `${bf.card.name}|${powerStr}|${toughnessStr}|${JSON.stringify(bf.counters ?? {})}`;
    const existing = groups.get(key);
    if (existing) existing.count++;
    else
      groups.set(key, { name: bf.card.name, power: powerStr, toughness: toughnessStr, count: 1 });
  }

  return { attackers: creatures.length, power, groups: [...groups.values()] };
}

/** Mills the horde's library for `damage` cards (clamped >= 0). */
export function millForDamage(damage: number): PlaytestAction {
  return { type: 'MOVE_TOP_N', n: Math.max(0, Math.floor(damage)), to: 'graveyard' };
}

/**
 * Which boss ticks this change crosses. `ticks` are fractions of the
 * library gone (1 = library empty). Each tick can only be reported once
 * across a game, because `remainingBefore`/`remainingAfter` only ever moves
 * one way (the library only shrinks) — so a single sequence of calls with
 * the running remaining count naturally fires every tick exactly once.
 */
export function bossesCrossed(
  librarySizeAtStart: number,
  remainingBefore: number,
  remainingAfter: number,
  ticks: readonly number[]
): number[] {
  if (librarySizeAtStart <= 0) return [];
  const fractionBefore = (librarySizeAtStart - remainingBefore) / librarySizeAtStart;
  const fractionAfter = (librarySizeAtStart - remainingAfter) / librarySizeAtStart;
  const crossed: number[] = [];
  ticks.forEach((tick, i) => {
    if (fractionBefore < tick && fractionAfter >= tick) crossed.push(i);
  });
  return crossed;
}

/** `won` once the library is empty and the horde controls no creatures;
 *  `lost` at 0 shared survivor life; `null` while the game continues. Life
 *  is checked first, so a killing blow that also empties the library still
 *  reads as a loss. */
export function hordeOutcome(horde: PlaytestState, survivorsLife: number): 'won' | 'lost' | null {
  if (survivorsLife <= 0) return 'lost';
  const noCreatures = !horde.battlefield.some((b) => isCreature(b.card));
  if (horde.zones.library.length === 0 && noCreatures) return 'won';
  return null;
}
