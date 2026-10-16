// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BracketEstimation } from '@spellcontrol/deck-metrics';

let user: { id: string } | null = { id: 'u1' };
vi.mock('../../store/auth', () => ({
  useAuth: <T,>(selector: (s: { user: { id: string } | null }) => T): T => selector({ user }),
}));

import { BracketVote } from './BracketVote';

const estimation = {
  bracket: 2,
  label: 'Core',
  softScore: 30,
  hardFloors: [{ bracket: 2, reason: 'Baseline' }],
  breakdown: { gameChangerCount: 0 },
} as unknown as BracketEstimation;

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
  user = { id: 'u1' };
  fetchMock.mockReset();
  fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
    init?.method === 'PUT'
      ? reply({ vote: JSON.parse(init.body as string) })
      : reply({ vote: null })
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

const putCall = () => fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');

describe('BracketVote', () => {
  it('renders nothing for a signed-out visitor and asks the server nothing', () => {
    user = null;
    const { container } = render(
      <BracketVote deckId="d1" listText="1 Sol Ring" estimation={estimation} stated={null} />
    );
    expect(container.innerHTML).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends "Looks right" as an agreement with the optional note', async () => {
    render(<BracketVote deckId="d1" listText="1 Sol Ring" estimation={estimation} stated={null} />);
    const button = screen.getByRole('button', { name: 'Looks right' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: ' fits ' } });
    fireEvent.click(button);
    await waitFor(() => expect(putCall()).toBeTruthy());
    const body = JSON.parse(putCall()![1].body as string);
    expect(body).toMatchObject({
      deckId: 'd1',
      estimatedBracket: 2,
      statedBracket: 2,
      vote: 'agree',
      note: 'fits',
    });
    expect(body.deckHash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.signals.softScore).toBe(30);
    expect(await screen.findByRole('status')).toBeTruthy();
  });

  it('turns a differing stated bracket into a disagreement, without a second picker', async () => {
    render(<BracketVote deckId="d1" listText="1 Sol Ring" estimation={estimation} stated={3} />);
    expect(screen.getByText('You set Bracket 3. The estimate is Bracket 2.')).toBeTruthy();
    expect(screen.queryByRole('radio')).toBeNull();
    const button = screen.getByRole('button', { name: 'Send feedback' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(putCall()).toBeTruthy());
    expect(JSON.parse(putCall()![1].body as string)).toMatchObject({
      vote: 'disagree',
      statedBracket: 3,
      estimatedBracket: 2,
    });
  });

  it('caps the note at 280 characters', () => {
    render(<BracketVote deckId="d1" listText="1 Sol Ring" estimation={estimation} stated={null} />);
    expect((screen.getByLabelText('Note (optional)') as HTMLTextAreaElement).maxLength).toBe(280);
  });

  it('shows an earlier vote as sent and holds the button until something changes', async () => {
    fetchMock.mockImplementation(() =>
      reply({ vote: { vote: 'agree', statedBracket: 2, estimatedBracket: 2, note: 'ok' } })
    );
    render(<BracketVote deckId="d1" listText="1 Sol Ring" estimation={estimation} stated={null} />);
    expect(await screen.findByRole('status')).toBeTruthy();
    expect((screen.getByLabelText('Note (optional)') as HTMLTextAreaElement).value).toBe('ok');
    expect(
      (screen.getByRole('button', { name: 'Looks right' }) as HTMLButtonElement).disabled
    ).toBe(true);
    fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'ok, mostly' } });
    expect(
      (screen.getByRole('button', { name: 'Looks right' }) as HTMLButtonElement).disabled
    ).toBe(false);
  });

  it('says so when the send fails and keeps the button usable', async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === 'PUT' ? reply({ error: 'x' }, 500) : reply({ vote: null })
    );
    render(<BracketVote deckId="d1" listText="1 Sol Ring" estimation={estimation} stated={null} />);
    const button = screen.getByRole('button', { name: 'Looks right' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(button);
    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't send that. Try again.");
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });
});
