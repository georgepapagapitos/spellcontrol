// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpellbookSecondOpinion } from './SpellbookSecondOpinion';
import { buildSpellbookRequest, SPELLBOOK_TAG_LABELS } from '@/lib/deck-analysis/spellbook-bracket';

const request = buildSpellbookRequest(['Atraxa'], ['Sol Ring', 'Island', 'Island']);
const fetchMock = vi.fn();

function reply(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('buildSpellbookRequest', () => {
  it('counts the mainboard by name and keeps commanders apart', () => {
    expect(request).toEqual({
      commanders: ['Atraxa'],
      cards: [
        { name: 'Sol Ring', quantity: 1 },
        { name: 'Island', quantity: 2 },
      ],
    });
  });
});

describe('SpellbookSecondOpinion', () => {
  it('shows a loading line, then their tag as their word, credited and linked', async () => {
    fetchMock.mockImplementation(() => reply({ tag: 'P', cached: false }));
    render(<SpellbookSecondOpinion request={request} />);
    expect(screen.getByText('Asking Commander Spellbook…')).toBeTruthy();
    expect(await screen.findByText('Powerful')).toBeTruthy();
    // Their scheme is shown as theirs: no B-number is invented from it.
    expect(document.body.textContent).not.toMatch(/\bB[1-5]\b/);
    const link = screen.getByRole('link', { name: /Commander Spellbook/ });
    expect(link.getAttribute('href')).toBe('https://commanderspellbook.com/');
    expect(link.getAttribute('rel')).toContain('noopener');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/spellbook/bracket');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual(request);
  });

  it('has a label for every tag the backend passes through', () => {
    expect(Object.keys(SPELLBOOK_TAG_LABELS).sort()).toEqual(['B', 'C', 'E', 'O', 'P', 'R', 'S']);
  });

  it('says when Spellbook has no answer and retries on request', async () => {
    fetchMock.mockImplementationOnce(() => reply({ error: 'x' }, 503));
    render(<SpellbookSecondOpinion request={request} />);
    expect(await screen.findByText('Commander Spellbook has no answer right now.')).toBeTruthy();
    fetchMock.mockImplementationOnce(() => reply({ tag: 'C' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Core')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('says it could not reach them on a network failure, without throwing', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new TypeError('offline')));
    render(<SpellbookSecondOpinion request={request} />);
    expect(await screen.findByText("Couldn't reach Commander Spellbook.")).toBeTruthy();
  });

  it('treats an unknown tag as a failure instead of guessing', async () => {
    fetchMock.mockImplementation(() => reply({ tag: 'Z' }));
    render(<SpellbookSecondOpinion request={request} />);
    expect(await screen.findByText("Couldn't reach Commander Spellbook.")).toBeTruthy();
  });

  it('does not refetch for a new array holding the same list', async () => {
    fetchMock.mockImplementation(() => reply({ tag: 'C' }));
    const { rerender } = render(<SpellbookSecondOpinion request={request} />);
    await screen.findByText('Core');
    rerender(<SpellbookSecondOpinion request={structuredClone(request)} />);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
