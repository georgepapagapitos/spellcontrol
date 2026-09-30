// @vitest-environment happy-dom
// T112 — the AI sources contract control: one fieldset every AI surface on the
// deck reads. Self-hiding without consent, four real radios with it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AiSourcesControl } from './AiSourcesControl';
import { __resetAiStatus } from '@/lib/ai/use-ai-status';
import { useCurrencyStore } from '@/lib/collection/currency';

function stubStatus(optIn: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ optIn, used: 2, limit: 10 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    )
  );
}

beforeEach(() => __resetAiStatus());
afterEach(() => vi.unstubAllGlobals());

describe('AiSourcesControl', () => {
  it('renders nothing until the feature is on', async () => {
    stubStatus(false);
    const { container } = render(<AiSourcesControl value="any" onChange={() => {}} />);
    await waitFor(() =>
      expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).not.toHaveLength(0)
    );
    expect(container.querySelector('.ai-sources')).toBeNull();
  });

  it('offers the four scopes as radios and reports a change', async () => {
    stubStatus(true);
    const onChange = vi.fn();
    render(<AiSourcesControl value="any" onChange={onChange} />);
    const radios = await screen.findAllByRole('radio');
    expect(radios).toHaveLength(4);
    expect(screen.getByRole('radio', { name: /Any card/ })).toHaveProperty('checked', true);
    fireEvent.click(screen.getByRole('radio', { name: /Cards you own/ }));
    expect(onChange).toHaveBeenCalledWith('owned');
    fireEvent.click(screen.getByRole('radio', { name: /Budget picks/ }));
    expect(onChange).toHaveBeenCalledWith('budget');
    // The ceiling is stated on the option, never left for the reading to reveal.
    expect(screen.getByText(/under \$5/)).toBeTruthy();
    // The cost of a change is stated on the control, with the real cap.
    expect(screen.getByText(/counts toward today's 10/)).toBeTruthy();
  });

  it('disables the collection scopes when there is no collection to search', async () => {
    stubStatus(true);
    render(<AiSourcesControl value="any" onChange={() => {}} collectionEmpty />);
    expect(await screen.findByRole('radio', { name: /Cards you own/ })).toHaveProperty(
      'disabled',
      true
    );
    expect(screen.getByRole('radio', { name: /Free copies you own/ })).toHaveProperty(
      'disabled',
      true
    );
    expect(screen.getByRole('radio', { name: /Any card/ })).toHaveProperty('disabled', false);
    // Budget needs no collection — it reads prices, not ownership.
    expect(screen.getByRole('radio', { name: /Budget picks/ })).toHaveProperty('disabled', false);
  });

  it('writes the ceiling in the display currency', async () => {
    stubStatus(true);
    useCurrencyStore.getState().setCurrency('EUR');
    try {
      render(<AiSourcesControl value="budget" onChange={() => {}} />);
      expect(await screen.findByText(/under €5/)).toBeTruthy();
    } finally {
      useCurrencyStore.getState().setCurrency('USD');
    }
  });
});
