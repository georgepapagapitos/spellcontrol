// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CardSearchPanel } from './CardSearchPanel';
import type { GapAnalysisCard } from '@/deck-builder/types';
import {
  resetScryfallRateLimit,
  scryfallRequest,
  setScryfallRealTimingForTests,
} from '@/lib/cards/scryfall-fetch';

// The lookup a press resolves; the test holds it open like a parked request.
const lookup = vi.hoisted(() => ({ release: null as null | (() => void), calls: 0 }));
vi.mock('@/deck-builder/services/scryfall/client', async (orig) => ({
  ...(await orig<typeof import('@/deck-builder/services/scryfall/client')>()),
  getCardByNameResilient: (name: string) =>
    new Promise((resolve) => {
      lookup.calls += 1;
      lookup.release = () => resolve({ id: `id-${name}`, name });
    }),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetScryfallRateLimit();
  lookup.calls = 0;
});

const gap = {
  name: 'Cultivate',
  role: 'ramp',
  roleLabel: 'Ramp',
  inclusion: 64,
} as GapAnalysisCard;

function renderPanel(onAdd = vi.fn()) {
  render(
    <CardSearchPanel
      deckId="d1"
      commanderColorIdentity={['G']}
      existingCardCounts={new Map()}
      atCopyLimit={() => false}
      onAdd={onAdd}
      enableSuggestions
      suggestions={[gap]}
      ownershipFor={() => 'owned'}
    />
  );
  return onAdd;
}

describe('CardSearchPanel while Scryfall is rate-limiting (E329)', () => {
  it('shows the pressed add as busy, ignores a repeat press, and adds once it resolves', async () => {
    const onAdd = renderPanel();
    const add = screen.getByRole('button', { name: 'Add Cultivate' });
    expect(add.getAttribute('aria-busy')).toBeNull();

    fireEvent.click(add);
    expect(add.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(add);
    expect(lookup.calls).toBe(1);

    await act(async () => {
      lookup.release?.();
    });
    expect(add.getAttribute('aria-busy')).toBeNull();
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('announces the cooldown in a polite live region and clears it when the window ends', async () => {
    setScryfallRealTimingForTests(true);
    vi.useFakeTimers();
    let throttled = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).includes('/cards/named') && !throttled) {
        throttled = true;
        return new Response('slow down', { status: 429, headers: { 'Retry-After': '19' } });
      }
      return new Response('{}', { status: 200 });
    });
    renderPanel();
    expect(screen.queryByText(/rate-limiting/)).toBeNull();

    let request: Promise<Response> | undefined;
    await act(async () => {
      request = scryfallRequest('/cards/named?exact=Cultivate');
      await vi.advanceTimersByTimeAsync(5000);
    });
    const note = screen.getByText(/Scryfall is rate-limiting requests/);
    expect(note.closest('[role="status"]')?.getAttribute('aria-live')).toBe('polite');
    expect(note.textContent).toMatch(/\(\d+s\)/);

    await act(async () => {
      await vi.runAllTimersAsync();
      await request;
    });
    expect(screen.queryByText(/rate-limiting/)).toBeNull();
  });
});
