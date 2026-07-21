// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/use-can-scan', () => ({
  useCanScan: vi.fn(() => false),
}));

vi.mock('./CardScanner', () => ({
  CardScanner: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="card-scanner">
      <button type="button" onClick={onClose}>
        close-scanner
      </button>
    </div>
  ),
}));

import { useCanScan } from '../lib/use-can-scan';
import { ScanFab } from './ScanFab';

function renderFab() {
  return render(
    <MemoryRouter>
      <ScanFab />
    </MemoryRouter>
  );
}

describe('ScanFab', () => {
  it('renders nothing when the device cannot scan', () => {
    vi.mocked(useCanScan).mockReturnValue(false);
    const { container } = renderFab();
    expect(container.firstChild).toBeNull();
  });

  it('renders a single direct Scan action with no speed-dial/menu semantics', () => {
    vi.mocked(useCanScan).mockReturnValue(true);
    renderFab();
    expect(screen.getByRole('button', { name: 'Scan cards' })).toBeTruthy();
    // No NAV_ITEMS-shaped destinations or disclosure-widget semantics remain.
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByLabelText('Open navigation')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('opens CardScanner directly on tap — no intermediate expand step', async () => {
    vi.mocked(useCanScan).mockReturnValue(true);
    renderFab();
    expect(screen.queryByTestId('card-scanner')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Scan cards' }));
    await waitFor(() => expect(screen.getByTestId('card-scanner')).toBeTruthy());
  });
});
