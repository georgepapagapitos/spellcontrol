// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AdminPanel } from './AdminPanel';
import type { AdminUserSummary, AdminReportRow, AiSpend } from '../lib/admin-api';

// AdminPanel's own network calls are mocked; Modal is real, so this is an
// integration-style test of the confirm-gating wiring around clearUserProfile
// (mirrors how UploadPanel.test.tsx treats Modal as real infrastructure).
const listUsersMock = vi.fn<() => Promise<AdminUserSummary[]>>();
const clearUserProfileMock = vi.fn<(id: string) => Promise<void>>();
// AdminPanel also fetches the Reports section on mount — stub it to an empty
// list so this file's own test (which only exercises the Users card) isn't
// left with an unresolved/rejected fetch.
const listReportsMock = vi.fn<() => Promise<AdminReportRow[]>>(() => Promise.resolve([]));
const resolveReportMock =
  vi.fn<(id: string, action: 'dismiss' | 'hide') => Promise<{ changed: boolean }>>();
const deleteUserMock = vi.fn<(id: string) => Promise<void>>();
const setUserAiMock =
  vi.fn<(id: string, patch: { access?: boolean; dailyLimit?: number | null }) => Promise<void>>();
const setUserRoleMock = vi.fn<(id: string, role: 'admin' | 'user') => Promise<void>>();
const emptyWindow = {
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  usd: 0,
};
const getAiSpendMock = vi.fn<() => Promise<AiSpend>>(() =>
  Promise.resolve({
    model: 'claude-haiku-4-5',
    windows: { today: emptyWindow, d7: emptyWindow, d30: emptyWindow },
    users: [],
  })
);
vi.mock('../lib/admin-api', () => ({
  listUsers: () => listUsersMock(),
  getAiSpend: () => getAiSpendMock(),
  deleteUser: (id: string) => deleteUserMock(id),
  clearUserProfile: (id: string) => clearUserProfileMock(id),
  setUserAi: (id: string, patch: { access?: boolean; dailyLimit?: number | null }) =>
    setUserAiMock(id, patch),
  setUserRole: (id: string, role: 'admin' | 'user') => setUserRoleMock(id, role),
  listReports: () => listReportsMock(),
  resolveReport: (id: string, action: 'dismiss' | 'hide') => resolveReportMock(id, action),
}));
import { useToastsStore } from '../store/toasts';
const toastMessages = () => useToastsStore.getState().toasts.map((t) => t.message);
/** What handleResponse throws for a 404: the server's copy with `.status` on it. */
const gone = (message: string) => Object.assign(new Error(message), { status: 404 });
const gameReport: AdminReportRow = {
  id: 'r-gr',
  kind: 'game-result',
  targetLabel: 'commander game — 9/18/2026',
  reporterUsername: null,
  reason: 'Fake result',
  createdAt: Date.parse('2026-09-19T00:00:00Z'),
};

const baseUser: AdminUserSummary = {
  id: 'u1',
  username: 'nova',
  role: 'user',
  createdAt: Date.parse('2026-01-01T00:00:00Z'),
  dataBytes: 1024,
  displayName: 'Nova',
  bio: 'Cube drafter',
  avatarCardName: null,
  aiAccess: false,
  aiDailyLimit: null,
};

describe('AdminPanel — AI spend (T116)', () => {
  it('renders the three windows in USD and the per-user 30-day column', async () => {
    listUsersMock.mockResolvedValueOnce([baseUser, { ...baseUser, id: 'u2', username: 'orin' }]);
    getAiSpendMock.mockResolvedValueOnce({
      model: 'claude-haiku-4-5',
      windows: {
        today: { ...emptyWindow, calls: 1, usd: 0.0123 },
        d7: { ...emptyWindow, calls: 4, usd: 0.5 },
        d30: { ...emptyWindow, calls: 12, usd: 2.345 },
      },
      users: [{ ...emptyWindow, userId: 'u1', calls: 12, usd: 2.345 }],
    });
    render(<AdminPanel currentUserId="admin-1" />);
    await screen.findByText('$0.01');
    expect(screen.getByText('Today · 1 call')).toBeTruthy();
    expect(screen.getByText('$0.50')).toBeTruthy();
    expect(screen.getByText('30 days · 12 calls')).toBeTruthy();
    expect(screen.getByText(/for claude-haiku-4-5/)).toBeTruthy();
    await screen.findByText('orin');
    // nova has spend in the per-user list, orin does not.
    expect(screen.getAllByText('$2.35')).toHaveLength(2);
    expect(screen.queryByText('No AI calls in the last 30 days.')).toBeNull();
  });

  it('shows the empty hint and a Retry on failure', async () => {
    listUsersMock.mockResolvedValueOnce([]);
    // A non-noise Error message is shown verbatim (userMessage), so match it.
    getAiSpendMock.mockRejectedValueOnce(new Error('Spend service is down'));
    render(<AdminPanel currentUserId="admin-1" />);
    await screen.findByText('Spend service is down');
    getAiSpendMock.mockResolvedValueOnce({
      model: 'claude-haiku-4-5',
      windows: { today: emptyWindow, d7: emptyWindow, d30: emptyWindow },
      users: [],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('No AI calls in the last 30 days.');
  });
});

describe('AdminPanel — AI access (T114)', () => {
  it('shows Off, then saves access + limit from the dialog and re-renders On', async () => {
    listUsersMock.mockResolvedValueOnce([baseUser]);
    render(<AdminPanel currentUserId="admin-1" />);
    await screen.findByText('nova');
    expect(screen.getByText('Off')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Actions for nova' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'AI access…' }));
    await screen.findByText('AI access for nova');

    // A non-numeric limit disables Save with a hint; blank/whole numbers are fine.
    const limit = screen.getByLabelText('Daily limit');
    fireEvent.change(limit, { target: { value: '2.5' } });
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(limit, { target: { value: '25' } });
    fireEvent.click(screen.getByLabelText('Allow AI features'));

    listUsersMock.mockResolvedValueOnce([{ ...baseUser, aiAccess: true, aiDailyLimit: 25 }]);
    setUserAiMock.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(setUserAiMock).toHaveBeenCalledWith('u1', { access: true, dailyLimit: 25 })
    );
    await waitFor(() => expect(screen.queryByText('AI access for nova')).toBeNull());
    await screen.findByText('On');
    expect(screen.getByText('25/day')).toBeTruthy();
  });
});

describe('AdminPanel — clear profile', () => {
  it('cancel fires no API call; confirm clears the profile and refreshes the row', async () => {
    listUsersMock.mockResolvedValueOnce([baseUser]);

    render(<AdminPanel currentUserId="admin-1" />);
    await screen.findByText('nova');

    fireEvent.click(screen.getByRole('button', { name: 'Actions for nova' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear profile' }));
    await screen.findByText('Clear profile?');

    // Cancel: dismisses without calling the API.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Clear profile?')).toBeNull());
    expect(clearUserProfileMock).not.toHaveBeenCalled();

    // Re-open and confirm; the refetch after success returns a cleared row.
    listUsersMock.mockResolvedValueOnce([{ ...baseUser, displayName: null, bio: null }]);
    clearUserProfileMock.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Actions for nova' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear profile' }));
    await screen.findByText('Clear profile?');
    fireEvent.click(screen.getByRole('button', { name: 'Clear profile' }));

    await waitFor(() => expect(clearUserProfileMock).toHaveBeenCalledWith('u1'));
    await waitFor(() => expect(screen.queryByText('Clear profile?')).toBeNull());
    await waitFor(() => expect(screen.queryByText('Nova')).toBeNull());
    // Two dashes: the cleared Profile cell and the (empty) AI spend cell.
    expect(screen.getAllByText('—')).toHaveLength(2);
  });
});

describe('AdminPanel — role management', () => {
  it('cancel fires no API call; confirm grants admin and the row reflects it', async () => {
    listUsersMock.mockResolvedValueOnce([baseUser]);

    render(<AdminPanel currentUserId="admin-1" />);
    await screen.findByText('nova');

    fireEvent.click(screen.getByRole('button', { name: 'Actions for nova' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Make admin…' }));
    await screen.findByText('Make admin?');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Make admin?')).toBeNull());
    expect(setUserRoleMock).not.toHaveBeenCalled();

    listUsersMock.mockResolvedValueOnce([{ ...baseUser, role: 'admin' }]);
    setUserRoleMock.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Actions for nova' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Make admin…' }));
    await screen.findByText('Make admin?');
    fireEvent.click(screen.getByRole('button', { name: 'Make admin' }));

    await waitFor(() => expect(setUserRoleMock).toHaveBeenCalledWith('u1', 'admin'));
    await waitFor(() => expect(screen.getByText('admin')).toBeTruthy());
    expect(toastMessages()).toContain('nova is an admin');
  });

  it('offers revoke for an existing admin, and sends role=user', async () => {
    listUsersMock.mockResolvedValueOnce([{ ...baseUser, role: 'admin' }]);
    render(<AdminPanel currentUserId="admin-1" />);
    await screen.findByText('nova');

    fireEvent.click(screen.getByRole('button', { name: 'Actions for nova' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Revoke admin…' }));
    await screen.findByText('Revoke admin?');

    listUsersMock.mockResolvedValueOnce([baseUser]);
    setUserRoleMock.mockResolvedValueOnce(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke admin' }));

    await waitFor(() => expect(setUserRoleMock).toHaveBeenCalledWith('u1', 'user'));
    expect(toastMessages()).toContain('nova is no longer an admin');
  });

  it('disables the role action on your own row', async () => {
    listUsersMock.mockResolvedValueOnce([{ ...baseUser, id: 'admin-1', role: 'admin' }]);
    render(<AdminPanel currentUserId="admin-1" />);
    await screen.findByText('nova');

    fireEvent.click(screen.getByRole('button', { name: 'Actions for nova' }));
    const item = screen.getByRole('menuitem', { name: "Can't change your own role" });
    expect(item.hasAttribute('disabled') || item.getAttribute('aria-disabled') === 'true').toBe(
      true
    );
  });
});

describe('AdminPanel — reports (playtest batch 12)', () => {
  it('hide on a game-result report names the game result, not a deck', async () => {
    listUsersMock.mockResolvedValueOnce([]);
    listReportsMock.mockResolvedValueOnce([gameReport]);
    resolveReportMock.mockResolvedValueOnce({ changed: true });
    render(<AdminPanel currentUserId="admin-1" />);
    await screen.findByText('Fake result');
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    await screen.findByText('Hide this content?');
    expect(screen.getByText(/revokes the shared game result/)).toBeTruthy();
    expect(screen.queryByText(/unpublishes the deck/)).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Hide' }).at(-1)!);
    await waitFor(() => expect(resolveReportMock).toHaveBeenCalledWith('r-gr', 'hide'));
    await waitFor(() => expect(toastMessages()).toContain('Hid the game result'));
  });

  it('a 404 on Dismiss (handled in another tab) drops the row and says so', async () => {
    listUsersMock.mockResolvedValueOnce([]);
    listReportsMock.mockResolvedValueOnce([gameReport]);
    resolveReportMock.mockRejectedValueOnce(gone('Report not found.'));
    render(<AdminPanel currentUserId="admin-1" />);
    await screen.findByText('Fake result');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByText('Fake result')).toBeNull());
    expect(toastMessages()).toContain('That report was already handled.');
    await screen.findByText('No open reports.');
  });

  it('a 404 on Hide closes the dialog and drops the row', async () => {
    listUsersMock.mockResolvedValueOnce([]);
    listReportsMock.mockResolvedValueOnce([gameReport]);
    resolveReportMock.mockRejectedValueOnce(gone('Report not found.'));
    render(<AdminPanel currentUserId="admin-1" />);
    await screen.findByText('Fake result');
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    await screen.findByText('Hide this content?');
    fireEvent.click(screen.getAllByRole('button', { name: 'Hide' }).at(-1)!);
    await waitFor(() => expect(screen.queryByText('Hide this content?')).toBeNull());
    expect(screen.queryByText('Fake result')).toBeNull();
    expect(toastMessages()).toContain('That report was already handled.');
  });

  it('Hide on a report whose target was already taken down says so instead of "Hid the …" (E352)', async () => {
    const deckReport: AdminReportRow = {
      id: 'r-deck',
      kind: 'deck',
      targetLabel: 'Krenko Goes Wide by tradepal',
      reporterUsername: null,
      reason: 'Spam',
      createdAt: Date.parse('2026-09-19T00:00:00Z'),
    };
    listUsersMock.mockResolvedValueOnce([]);
    listReportsMock.mockResolvedValueOnce([deckReport]);
    // The route resolved (200) but the UPDATE touched 0 rows — already
    // unpublished by the time the admin acted on the report.
    resolveReportMock.mockResolvedValueOnce({ changed: false });
    render(<AdminPanel currentUserId="admin-1" />);
    await screen.findByText('Krenko Goes Wide by tradepal');
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    await screen.findByText('Hide this content?');
    fireEvent.click(screen.getAllByRole('button', { name: 'Hide' }).at(-1)!);
    await waitFor(() => expect(resolveReportMock).toHaveBeenCalledWith('r-deck', 'hide'));
    await waitFor(() => expect(toastMessages()).toContain('Already unpublished; report closed.'));
    expect(toastMessages()).not.toContain('Hid the deck');
  });
});

describe('AdminPanel — users (playtest batch 12)', () => {
  it('a 404 on Delete (deleted in another tab) closes the dialog and refreshes the list', async () => {
    listUsersMock.mockResolvedValueOnce([baseUser]);
    deleteUserMock.mockRejectedValueOnce(gone('User not found.'));
    render(<AdminPanel currentUserId="admin-1" />);
    await screen.findByText('nova');
    fireEvent.click(screen.getByRole('button', { name: 'Actions for nova' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await screen.findByText('Delete nova?');
    listUsersMock.mockResolvedValueOnce([]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' }).at(-1)!);
    await waitFor(() => expect(screen.queryByText('Delete nova?')).toBeNull());
    await screen.findByText('No users yet.');
    expect(toastMessages()).toContain('nova was already deleted.');
  });

  it('a 404 on AI access Save closes the dialog and refreshes the list', async () => {
    listUsersMock.mockResolvedValueOnce([baseUser]);
    setUserAiMock.mockRejectedValueOnce(gone('User not found.'));
    render(<AdminPanel currentUserId="admin-1" />);
    await screen.findByText('nova');
    fireEvent.click(screen.getByRole('button', { name: 'Actions for nova' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'AI access…' }));
    await screen.findByText('AI access for nova');
    listUsersMock.mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByText('AI access for nova')).toBeNull());
    await screen.findByText('No users yet.');
  });
});
