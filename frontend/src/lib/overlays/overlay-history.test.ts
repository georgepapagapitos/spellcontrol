// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOverlayHistoryController, type OverlayHistoryController } from './overlay-history';

let controller: OverlayHistoryController | null = null;

afterEach(() => {
  controller?.destroy();
  controller = null;
});

function isMarked(): boolean {
  return !!(window.history.state as { __scOverlayBack?: boolean } | null)?.__scOverlayBack;
}

/**
 * Resets to a fresh two-entry history [P(idx0), A(idx1)], current = A — the
 * shared starting point ("[P, A]") for every acceptance sequence below. The
 * explicit `idx` mirrors what react-router stamps on every entry it creates;
 * `markCurrentEntry` spreads it verbatim, which is what lets the
 * stale-marker-idx mechanism work.
 */
function startAtA(): void {
  window.history.pushState({ idx: 0 }, '', '/P');
  window.history.pushState({ idx: 1 }, '', '/A');
}

/**
 * A tiny fake "overlay stack" matching `OverlayHistoryHooks` exactly. Each
 * open entry's own `dismiss` decides accept/refuse; a synchronous accept
 * removes it immediately. Real sheets/Modals do this asynchronously, after an
 * exit animation, but the controller only ever reads `participantCount`
 * before deciding, so the timing of the removal itself doesn't matter to it.
 */
function fakeStack() {
  const stack: Array<{ dismiss: () => boolean }> = [];
  return {
    stack,
    open(dismiss: () => boolean) {
      stack.push({ dismiss });
    },
    participantCount: () => stack.length,
    dismissTopmost: (): boolean => {
      const top = stack[stack.length - 1];
      if (!top) return false;
      const accepted = top.dismiss();
      if (accepted) stack.pop();
      return accepted;
    },
  };
}

describe('createOverlayHistoryController — acceptance sequences (E481 coordinator review)', () => {
  it('1. open → Back closes → Back leaves. One press each.', () => {
    startAtA();
    const s = fakeStack();
    controller = createOverlayHistoryController(s);
    s.open(() => true); // a sheet/Modal that always accepts
    controller.registered();
    expect(isMarked()).toBe(true);

    window.history.back(); // closes
    expect(s.participantCount()).toBe(0);
    expect(window.location.pathname).toBe('/A'); // still here — not left yet

    window.history.back(); // leaves
    expect(window.location.pathname).toBe('/P');
  });

  it('2. open → ✕ → Back leaves in one press.', () => {
    startAtA();
    const s = fakeStack();
    controller = createOverlayHistoryController(s);
    s.open(() => true);
    controller.registered();

    s.stack.pop(); // closed via ✕ — lazy, no history call at all
    expect(window.location.pathname).toBe('/A');
    expect(isMarked()).toBe(true); // left in place, not consumed

    window.history.back(); // must leave in ONE press, not two
    expect(window.location.pathname).toBe('/P');
  });

  it('3. open → ✕ → navigate to B → Back lands on A in one press → Back leaves to P in one press.', () => {
    startAtA();
    const s = fakeStack();
    controller = createOverlayHistoryController(s);
    s.open(() => true);
    controller.registered();
    s.stack.pop(); // ✕

    window.history.pushState({ idx: 2 }, '', '/B'); // navigate away

    window.history.back(); // must land on A, not require a second press
    expect(window.location.pathname).toBe('/A');

    window.history.back(); // must leave to P
    expect(window.location.pathname).toBe('/P');
  });

  it('4. two nested → Back, Back close both → third Back leaves.', () => {
    startAtA();
    const s = fakeStack();
    controller = createOverlayHistoryController(s);
    s.open(() => true); // outer
    controller.registered();
    s.open(() => true); // inner (nested)
    controller.registered(); // reuses the same marked entry — no second push

    window.history.back(); // closes inner
    expect(s.participantCount()).toBe(1);
    expect(window.location.pathname).toBe('/A');

    window.history.back(); // closes outer
    expect(s.participantCount()).toBe(0);
    expect(window.location.pathname).toBe('/A');

    window.history.back(); // leaves
    expect(window.location.pathname).toBe('/P');
  });

  it('5. non-dismissable topmost → Back keeps it open (re-arms) → becomes dismissable → ✕ closes → one Back leaves.', () => {
    startAtA();
    const s = fakeStack();
    controller = createOverlayHistoryController(s);
    let dismissable = false;
    s.open(() => dismissable);
    controller.registered();

    window.history.back(); // refused — stays open, re-armed
    expect(s.participantCount()).toBe(1);
    expect(window.location.pathname).toBe('/A');

    window.history.back(); // still refused — must not leak past to P
    expect(s.participantCount()).toBe(1);
    expect(window.location.pathname).toBe('/A');

    dismissable = true;
    s.stack.pop(); // ✕ closes it now that it's dismissable (lazy, not via Back)

    window.history.back(); // must leave in ONE press
    expect(window.location.pathname).toBe('/P');
  });

  it('6a. close + navigate to B in the SAME tick → Back lands on A → Back leaves; no eager history.back().', () => {
    startAtA();
    const s = fakeStack();
    controller = createOverlayHistoryController(s);
    const backSpy = vi.spyOn(window.history, 'back');
    s.open(() => true);
    controller.registered();

    s.stack.pop(); // the action's close…
    window.history.pushState({ idx: 2 }, '', '/B'); // …and navigate, same tick
    expect(backSpy).not.toHaveBeenCalled();

    window.history.back();
    expect(window.location.pathname).toBe('/A');
    window.history.back();
    expect(window.location.pathname).toBe('/P');
    backSpy.mockRestore();
  });

  it('6b. close, then navigate to B in a LATER microtask/timeout → same outcome; still no eager history.back().', async () => {
    startAtA();
    const s = fakeStack();
    controller = createOverlayHistoryController(s);
    const backSpy = vi.spyOn(window.history, 'back');
    s.open(() => true);
    controller.registered();

    s.stack.pop();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    window.history.pushState({ idx: 2 }, '', '/B');
    expect(backSpy).not.toHaveBeenCalled();

    window.history.back();
    expect(window.location.pathname).toBe('/A');
    window.history.back();
    expect(window.location.pathname).toBe('/P');
    backSpy.mockRestore();
  });

  it('7. a marker entry that outlived a reload (current entry flagged at controller creation, nothing open) → one Back leaves.', () => {
    startAtA();
    // Simulate what a past session froze in place: A's entry marked, and
    // that mark is the current entry (as a lazy, non-Back close leaves it).
    window.history.pushState(
      { ...(window.history.state as object), __scOverlayBack: true },
      '',
      '/A'
    );

    // Fresh controller, fresh session — nothing has ever been registered.
    const s = fakeStack();
    controller = createOverlayHistoryController(s);
    expect(s.participantCount()).toBe(0);

    window.history.back(); // must leave in ONE press
    expect(window.location.pathname).toBe('/P');
  });

  it('8. forward/back afterward never strands the user on a same-page duplicate.', () => {
    startAtA();
    const s = fakeStack();
    controller = createOverlayHistoryController(s);
    s.open(() => true);
    controller.registered();
    s.stack.pop(); // ✕, lazy

    window.history.back(); // leaves to P (cascades past the stale marker)
    expect(window.location.pathname).toBe('/P');

    // Forward walks into A directly — a real revisit, not the marker (the
    // marker sits one step further forward still, and nothing here should
    // land on it or misfire against it).
    window.history.forward();
    expect(window.location.pathname).toBe('/A');

    // Back from there returns to P in exactly one more press — the earlier
    // cascade's bookkeeping was cleared, so it can't misfire here.
    window.history.back();
    expect(window.location.pathname).toBe('/P');
  });

  it('marks exactly one history entry when the first overlay opens; nested opens reuse it', () => {
    startAtA();
    const s = fakeStack();
    const lengthBefore = window.history.length;
    controller = createOverlayHistoryController(s);
    s.open(vi.fn(() => true));
    controller.registered();
    expect(window.history.length).toBe(lengthBefore + 1);
    expect(isMarked()).toBe(true);

    s.open(vi.fn(() => true));
    controller.registered(); // reuses the already-marked entry
    expect(window.history.length).toBe(lengthBefore + 1);
  });

  it('Escape and Back share the stack: Escape closes the top, then Back closes the next', () => {
    startAtA();
    const s = fakeStack();
    controller = createOverlayHistoryController(s);
    s.open(() => true); // outer
    controller.registered();
    s.open(() => true); // inner
    controller.registered();

    // Escape closes the inner directly (not through the controller at all).
    s.stack.pop();
    expect(s.participantCount()).toBe(1);

    // Now Back closes the outer.
    window.history.back();
    expect(s.participantCount()).toBe(0);
    expect(window.location.pathname).toBe('/A');
  });
});
