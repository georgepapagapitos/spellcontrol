// @vitest-environment happy-dom
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usePlayStore } from '@/store/play';
import { useAuth } from '@/store/auth';
import { createGameState, makePlayer } from '@/lib/game-state';
import { ReactionPicker } from './ReactionPicker';
import { REACTION_EMOTES, REACTION_LABEL } from '../lib/table-signals';

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

beforeEach(() => {
  useAuth.setState({ user: { id: 'me-id', username: 'me', role: 'user' } });
  usePlayStore.setState({ online: onlineGame(), sendSignal: vi.fn().mockResolvedValue(undefined) });
});

describe('ReactionPicker', () => {
  it('renders nothing in solo playtest (no online game)', () => {
    usePlayStore.setState({ online: null });
    const { container } = render(<ReactionPicker />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when online but this device holds no seat', () => {
    useAuth.setState({ user: { id: 'someone-else', username: 'x', role: 'user' } });
    const { container } = render(<ReactionPicker />);
    expect(container.innerHTML).toBe('');
  });

  it('is collapsed until the trigger is clicked, then shows all six reactions', () => {
    render(<ReactionPicker />);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'React' }));
    const menu = screen.getByRole('menu', { name: 'Reactions' });
    expect(menu).toBeTruthy();
    for (const emote of REACTION_EMOTES) {
      expect(screen.getByRole('menuitem', { name: REACTION_LABEL[emote] })).toBeTruthy();
    }
  });

  it.each(REACTION_EMOTES.map((emote) => [emote, REACTION_LABEL[emote]] as const))(
    'sends { kind: "reaction", emote: %s } and closes on %s',
    (emote, label) => {
      render(<ReactionPicker />);
      fireEvent.click(screen.getByRole('button', { name: 'React' }));
      fireEvent.click(screen.getByRole('menuitem', { name: label }));
      expect(usePlayStore.getState().sendSignal).toHaveBeenCalledWith({
        kind: 'reaction',
        emote,
      });
      expect(screen.queryByRole('menu')).toBeNull();
    }
  );
});
