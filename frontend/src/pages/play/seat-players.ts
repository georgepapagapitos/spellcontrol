import type { LocalGameSetup, SeatSeed } from '@/store/play';

export function blankPlayer(name: string): LocalGameSetup['players'][number] {
  return {
    name,
    userId: null,
    username: null,
    deckId: null,
    deckName: null,
    commander: null,
    partner: null,
    colorIdentity: [],
  };
}

/** A seat from a game night's seed: the name now, the account once friends load. */
export function seededPlayer(seed: SeatSeed | undefined): LocalGameSetup['players'][number] {
  return { ...blankPlayer(seed?.name ?? ''), username: seed?.username ?? null };
}
