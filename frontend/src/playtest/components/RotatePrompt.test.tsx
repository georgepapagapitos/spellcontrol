// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RotatePrompt } from './RotatePrompt';

interface Device {
  width: number;
  height: number;
  coarse: boolean;
}

/** Evaluate the prompt's real queries against a device, so every clause of
 *  them (orientation, width, height, pointer) is exercised rather than
 *  stubbed true. Orientation follows from the size, as it does on a device. */
function stubDevice({ width, height, coarse }: Device) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const maxWidth = /max-width:\s*(\d+)px/.exec(query);
    const maxHeight = /max-height:\s*(\d+)px/.exec(query);
    const portrait = height >= width;
    const matches =
      (!/orientation:\s*portrait/.test(query) || portrait) &&
      (!/orientation:\s*landscape/.test(query) || !portrait) &&
      (!maxWidth || width <= Number(maxWidth[1])) &&
      (!maxHeight || height <= Number(maxHeight[1])) &&
      (!/pointer:\s*coarse/.test(query) || coarse);
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    };
  });
}

const UPRIGHT_PHONE = { width: 390, height: 844, coarse: true };
const SIDEWAYS_PHONE = { width: 844, height: 390, coarse: true };

function setFullscreenEnabled(value: boolean) {
  Object.defineProperty(document, 'fullscreenEnabled', { value, configurable: true });
}

beforeEach(() => {
  sessionStorage.clear();
  setFullscreenEnabled(true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('RotatePrompt', () => {
  it('asks an upright phone to turn sideways, with fullscreen offered', () => {
    stubDevice(UPRIGHT_PHONE);
    render(<RotatePrompt fullscreen={false} />);
    expect(screen.getByRole('dialog', { name: 'Turn your phone sideways' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go fullscreen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeTruthy();
  });

  it('on its side, the phone is offered fullscreen alone', () => {
    stubDevice(SIDEWAYS_PHONE);
    render(<RotatePrompt fullscreen={false} />);
    expect(screen.getByRole('dialog', { name: 'Play fullscreen' })).toBeTruthy();
    expect(screen.queryByText('Turn your phone sideways')).toBeNull();
    expect(screen.getByRole('button', { name: 'Go fullscreen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeTruthy();
  });

  it('on its side, there is nothing to ask once fullscreen, or where fullscreen does not exist', () => {
    stubDevice(SIDEWAYS_PHONE);
    render(<RotatePrompt fullscreen />);
    expect(screen.queryByRole('dialog')).toBeNull();
    cleanup();
    setFullscreenEnabled(false);
    render(<RotatePrompt fullscreen={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each([
    ['an upright tablet', { width: 820, height: 1180, coarse: true }],
    ['a tablet on its side', { width: 1180, height: 820, coarse: true }],
    ['a narrow desktop window', { width: 390, height: 844, coarse: false }],
    ['a short desktop window', { width: 844, height: 390, coarse: false }],
  ])('stays away on %s', (_, device) => {
    stubDevice(device);
    render(<RotatePrompt fullscreen={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Skip dismisses it for the rest of the visit, in either orientation', () => {
    stubDevice(UPRIGHT_PHONE);
    render(<RotatePrompt fullscreen={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    cleanup();
    render(<RotatePrompt fullscreen={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    cleanup();
    stubDevice(SIDEWAYS_PHONE);
    render(<RotatePrompt fullscreen={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('upright, drops the fullscreen button where the browser has none, or it is already on', () => {
    stubDevice(UPRIGHT_PHONE);
    render(<RotatePrompt fullscreen />);
    expect(screen.queryByRole('button', { name: 'Go fullscreen' })).toBeNull();
    cleanup();
    setFullscreenEnabled(false);
    render(<RotatePrompt fullscreen={false} />);
    expect(screen.queryByRole('button', { name: 'Go fullscreen' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Skip' })).toBeTruthy();
  });

  it('Go fullscreen goes fullscreen, then locks to landscape', async () => {
    stubDevice(UPRIGHT_PHONE);
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const lock = vi.fn().mockResolvedValue(undefined);
    document.documentElement.requestFullscreen = requestFullscreen;
    Object.defineProperty(window.screen, 'orientation', { value: { lock }, configurable: true });
    render(<RotatePrompt fullscreen={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go fullscreen' }));
    await vi.waitFor(() => expect(lock).toHaveBeenCalledWith('landscape'));
    expect(requestFullscreen).toHaveBeenCalled();
  });
});
