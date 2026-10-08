// @vitest-environment happy-dom
/**
 * The strip is only the guest's sign-in hook now: a signed-in viewer's lens
 * lives in the deck view (rows, preview, the stat strip's "missing" stat).
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { OwnershipLensStrip } from './OwnershipLensStrip';

describe('OwnershipLensStrip', () => {
  it('links a guest to sign in', () => {
    render(
      <MemoryRouter>
        <OwnershipLensStrip />
      </MemoryRouter>
    );
    expect(screen.getByRole('link', { name: /Sign in to see what you own/ })).toBeTruthy();
  });
});
