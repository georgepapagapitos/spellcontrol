// @vitest-environment happy-dom
// The rulings list ends in a door to the rules Q&A about this card, only
// while AI is available, closing the preview before the page changes.
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CardRulings } from './CardRulings';

const aiState: { status: object | null } = { status: null };
vi.mock('@/lib/ai/use-ai-status', () => ({ useAiStatus: () => aiState.status }));
vi.mock('@/lib/cards/card-rulings', () => ({
  fetchCardRulings: () =>
    Promise.resolve([{ comment: 'It still exiles.', published_at: '2015-08-25' }]),
}));

beforeEach(() => {
  aiState.status = null;
});

function AskPage() {
  const loc = useLocation();
  return <p>asked: {(loc.state as { question: string }).question}</p>;
}

function renderRulings(onLeave = vi.fn()) {
  render(
    <MemoryRouter initialEntries={['/collection']}>
      <Routes>
        <Route
          path="/collection"
          element={<CardRulings scryfallId="x" name="Blood Moon" onLeave={onLeave} />}
        />
        <Route path="/rules" element={<AskPage />} />
      </Routes>
    </MemoryRouter>
  );
  return onLeave;
}

const door = () => screen.queryByRole('button', { name: /Ask a rules question about this card/ });

describe('CardRulings ask door', () => {
  it('stays hidden while AI is unavailable', async () => {
    renderRulings();
    fireEvent.click(screen.getByRole('button', { name: /Rulings/ }));
    expect(await screen.findByText('It still exiles.')).toBeTruthy();
    expect(door()).toBeNull();
  });

  it('offers no door outside a router, where there is no page to open', async () => {
    aiState.status = { optIn: true, used: 0, limit: 10 };
    render(<CardRulings scryfallId="x" name="Blood Moon" defaultOpen />);
    expect(await screen.findByText('It still exiles.')).toBeTruthy();
    expect(door()).toBeNull();
  });

  it('closes the preview, then opens Ask about the card', async () => {
    aiState.status = { optIn: true, used: 0, limit: 10 };
    const onLeave = renderRulings();
    fireEvent.click(screen.getByRole('button', { name: /Rulings/ }));
    await screen.findByText('It still exiles.');
    fireEvent.click(door()!);
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(screen.getByText('asked: How does Blood Moon work?')).toBeTruthy();
  });
});
