// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeckExportDialog } from './DeckExportDialog';

const LIST = '1x Sol Ring\n1x Not A Real Card';

function renderDialog(format: 'mpc' | 'mtga' = 'mpc') {
  return render(
    <DeckExportDialog
      text={LIST}
      format={format}
      onFormatChange={() => {}}
      title="My Deck!"
      onClose={() => {}}
    />
  );
}

let saved: { name: string; type: string }[];

beforeEach(() => {
  saved = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    saved.push({ name: '', type: (blob as Blob).type });
    return 'blob:x';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    saved[saved.length - 1].name = this.download;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DeckExportDialog MPC order file', () => {
  it('only shows for the MPC format', () => {
    renderDialog('mtga');
    expect(screen.queryByRole('button', { name: 'Download order file' })).toBeNull();
  });

  it('posts the list, saves the XML and names the cards left out', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        Response.json({ xml: '<order/>', slots: 1, missing: ['Not A Real Card'] })
      );
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Download order file' }));
    expect(screen.getByRole('button', { name: 'Matching images…' })).toHaveProperty(
      'disabled',
      true
    );

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('Saved My Deck.xml with 1 card.')
    );
    expect(screen.getByRole('status').textContent).toContain(
      'No image for this one, so it stayed out: Not A Real Card.'
    );
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain('/api/mpc/order');
    expect(JSON.parse(String(init?.body))).toEqual({ list: LIST });
    expect(saved).toEqual([{ name: 'My Deck.xml', type: 'application/xml' }]);
  });

  it("shows the server's error and saves nothing", async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        { error: "Couldn't reach MPC Autofill. Try again in a minute." },
        { status: 502 }
      )
    );
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Download order file' }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        "Couldn't reach MPC Autofill. Try again in a minute."
      )
    );
    expect(saved).toEqual([]);
    expect(screen.getByRole('button', { name: 'Download order file' })).toHaveProperty(
      'disabled',
      false
    );
  });

  it('says so when no card has an image, without saving an empty order', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ xml: '<order/>', slots: 0, missing: ['A', 'B'] })
    );
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Download order file' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        'MPC Autofill has no image for any card on this list.'
      )
    );
    expect(saved).toEqual([]);
  });
});
