// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ShareQrCode } from './ShareQrCode';

describe('ShareQrCode', () => {
  it('renders a scannable QR as one inline SVG path, labeled for screen readers', () => {
    render(<ShareQrCode value="https://spellcontrol.com/s/abc123" label="QR code for this link" />);

    const wrapper = screen.getByRole('img', { name: 'QR code for this link' });
    expect(wrapper.getAttribute('aria-label')).toBeTruthy();

    const svg = wrapper.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');

    const path = wrapper.querySelector('path');
    expect(path).not.toBeNull();
    expect(path?.getAttribute('d')).toBeTruthy();
  });

  it('falls back to inline text instead of crashing when create() throws', () => {
    // The real qrcode create() throws once the data exceeds the chosen
    // error-correction level's byte capacity — force that path with an
    // oversized value rather than mocking the module, so this exercises the
    // library's actual error behavior.
    const tooBig = 'x'.repeat(5000);
    render(<ShareQrCode value={tooBig} label="QR code for this link" />);

    expect(screen.getByText('QR code unavailable — use the link above.')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });
});
