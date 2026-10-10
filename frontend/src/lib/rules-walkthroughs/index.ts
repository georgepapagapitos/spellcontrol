import { apnap } from './apnap';
import { basicLoop, creatureEnters, holdPriority, respond } from './stack-basics';
import type { Walkthrough } from './types';

export type { StackItem, Walkthrough, WalkthroughStep } from './types';

export interface WalkthroughGroup {
  title: string;
  walkthroughs: Walkthrough[];
}

/** The index, in reading order: each group builds on the one before. */
export const WALKTHROUGH_GROUPS: WalkthroughGroup[] = [
  {
    title: 'Priority and the stack',
    walkthroughs: [basicLoop, holdPriority, respond, creatureEnters, apnap],
  },
];

export const WALKTHROUGHS: Walkthrough[] = WALKTHROUGH_GROUPS.flatMap((g) => g.walkthroughs);

export function getWalkthrough(id: string | undefined): Walkthrough | undefined {
  return WALKTHROUGHS.find((w) => w.id === id);
}
