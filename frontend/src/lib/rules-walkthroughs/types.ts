/**
 * Step-through walkthroughs of priority, the stack and triggered abilities
 * (board E357, M-1). Each step is one game event plus the state right after it.
 *
 * The event half (`type`, `cr`, `why`) is the shape a rules engine would emit
 * for the same transition, so these files can become an engine's expected
 * output unchanged. The state half is authored by hand and checked for
 * consistency by `checkWalkthrough` (steps.ts), not computed.
 */

export type PlayerId = string;

export interface WalkthroughPlayer {
  id: PlayerId;
  name: string;
}

/** A spell or ability on the stack, or a triggered ability waiting to go there. */
export interface StackItem {
  /** Unique within its walkthrough; the checker tracks items by it. */
  id: string;
  name: string;
  kind: 'spell' | 'ability' | 'trigger';
  controller: PlayerId;
  /** The ability's text or the spell's effect, one line. */
  text?: string;
  targets?: string[];
}

/**
 * What happened:
 * - `start`: the state the walkthrough opens on.
 * - `cast` / `activate`: the priority holder puts a spell or ability on the stack.
 * - `pass`: the priority holder passes.
 * - `resolve`: everyone passed in a row and the top of the stack resolves.
 * - `trigger`: waiting triggered abilities go on the stack.
 * - `turn`: a turn-based action or a step beginning; nobody has priority.
 * - `step-end`: everyone passed in a row on an empty stack.
 */
export type StepType =
  'start' | 'cast' | 'activate' | 'pass' | 'resolve' | 'trigger' | 'turn' | 'step-end';

export interface WalkthroughState {
  /** Bottom first; the last item is the top of the stack. */
  stack: StackItem[];
  /** Triggered abilities waiting to go on the stack. */
  pending: StackItem[];
  /** Who holds priority, or null while nobody does. */
  priority: PlayerId | null;
  /** Players who have passed in a row since the last thing happened. */
  passes: number;
  /** Permanents worth showing, by controller. Omitted players show nothing. */
  battlefield: Record<PlayerId, string[]>;
}

export interface WalkthroughStep extends WalkthroughState {
  type: StepType;
  /** The player who acted, for `cast`, `activate` and `pass`. */
  actor?: PlayerId;
  /** Ids of other stack objects a `resolve` takes off the stack: a counterspell's target. */
  removes?: string[];
  /** Comprehensive Rules numbers behind this step. Every one exists in the bundle. */
  cr: string[];
  /** One or two sentences: what happened and why. */
  why: string;
}

/** What an author writes: the event, plus only the parts of the state that changed. */
export type StepPatch = Omit<WalkthroughStep, keyof WalkthroughState> & Partial<WalkthroughState>;

export interface Walkthrough {
  id: string;
  title: string;
  /** One line for the index. */
  summary: string;
  /** Turn order, active player first. */
  players: WalkthroughPlayer[];
  /** Where the walkthrough opens, in a sentence or two. */
  setup: string;
  /** Oracle text quoted on the page, keyed by card name. */
  oracle?: Record<string, string>;
  /** Official rulings the walkthrough follows, as "<card>: <date>". */
  rulings?: string[];
  steps: WalkthroughStep[];
}
