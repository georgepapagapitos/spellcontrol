// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usePlayStore } from '@/store/play';
import { useAuth } from '@/store/auth';
import { createGameState, makePlayer } from '@/lib/game-state';
import { TableChat } from './TableChat';
import { MAX_CHAT_LEN } from '../lib/table-signals';

function onlineGame() {
  return createGameState({
    id: 'game1',
    code: 'ABCD',
    mode: 'online',
    hostUserId: 'me-id',
    format: 'commander',
    startingLife: 40,
    commanderDamageEnabled: true,
    poisonEnabled: false,
    players: [
      makePlayer({
        id: 'me',
        userId: 'me-id',
        seat: 0,
        name: 'Me',
        startingLife: 40,
        isHost: true,
      }),
      makePlayer({ id: 'p1', userId: 'u1', seat: 1, name: 'Rival', startingLife: 40 }),
    ],
  });
}

/** Factory rather than a bare `vi.fn()`, so `sendSignal`'s declared type keeps
 *  the resolved-value inference the store's own signature needs. */
function makeSendSignal() {
  return vi.fn().mockResolvedValue(undefined);
}

let sendSignal: ReturnType<typeof makeSendSignal>;

beforeEach(() => {
  sendSignal = makeSendSignal();
  useAuth.setState({ user: { id: 'me-id', username: 'me', role: 'user' } });
  usePlayStore.setState({ online: onlineGame(), sendSignal });
});

function field() {
  return screen.getByLabelText('Message the table');
}

describe('TableChat', () => {
  it('renders nothing in solo playtest (no online game)', () => {
    usePlayStore.setState({ online: null });
    const { container } = render(<TableChat idPrefix="t" />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when online but this device holds no seat', () => {
    useAuth.setState({ user: { id: 'someone-else', username: 'x', role: 'user' } });
    const { container } = render(<TableChat idPrefix="t" />);
    expect(container.innerHTML).toBe('');
  });

  it('sends the trimmed message and clears the box', () => {
    render(<TableChat idPrefix="t" />);
    fireEvent.change(field(), { target: { value: '  hold, I respond  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(sendSignal).toHaveBeenCalledWith({ kind: 'chat', text: 'hold, I respond' });
    expect((field() as HTMLInputElement).value).toBe('');
  });

  it('will not send an empty or whitespace-only message', () => {
    render(<TableChat idPrefix="t" />);
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toHaveProperty('disabled', true);

    fireEvent.change(field(), { target: { value: '   ' } });
    expect(send).toHaveProperty('disabled', true);
    fireEvent.click(send);
    expect(sendSignal).not.toHaveBeenCalled();
  });

  it('caps the field at the length the server accepts', () => {
    render(<TableChat idPrefix="t" />);
    expect(field().getAttribute('maxLength')).toBe(String(MAX_CHAT_LEN));
  });

  it('keeps keystrokes from reaching the board shortcuts underneath', () => {
    // The board binds bare letters (draw, untap, shuffle) at the document
    // level; typing "u" into chat must not untap anybody.
    const onDocKey = vi.fn();
    document.addEventListener('keydown', onDocKey);
    try {
      render(<TableChat idPrefix="t" />);
      fireEvent.keyDown(field(), { key: 'u' });
      expect(onDocKey).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('keydown', onDocKey);
    }
  });

  it('two instances can be mounted at once without colliding on element ids', () => {
    // A tablet has both the rail composer and the Log sheet's Table tab live.
    render(
      <>
        <TableChat idPrefix="rail" />
        <TableChat idPrefix="log-sheet" />
      </>
    );
    const ids = screen.getAllByPlaceholderText('Message the table').map((el) => el.id);
    expect(new Set(ids).size).toBe(2);
  });
});
