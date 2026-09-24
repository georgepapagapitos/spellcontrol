// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RotatePrompt } from './RotatePrompt';

/** Evaluate the prompt's real query against a device, so every clause of it
 *  (orientation, width, pointer) is exercised rather than stubbed true. */
function stubDevice({
  portrait,
  width,
  coarse,
}: {
  portrait: boolean;
  width: number;
  coarse: boolean;
}) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const maxWidth = /max-width:\s*(\d+)px/.exec(query);
    const matches =
      (!/orientation:\s*portrait/.test(query) || portrait) &&
      (!maxWidth || width <= Number(maxWidth[1])) &&
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

const UPRIGHT_PHONE = { portrait: true, width: 390, coarse: true };

beforeEach(() => {
  sessionStorage.clear();
  Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true });
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
  });

  it.each([
    ['a phone on its side', { portrait: false, width: 844, coarse: true }],
    ['an upright tablet', { portrait: true, width: 820, coarse: true }],
    ['a narrow desktop window', { portrait: true, width: 390, coarse: false }],
  ])('stays away on %s', (_, device) => {
    stubDevice(device);
    render(<RotatePrompt fullscreen={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Play upright dismisses it for the rest of the visit', () => {
    stubDevice(UPRIGHT_PHONE);
    render(<RotatePrompt fullscreen={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play upright' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    cleanup();
    render(<RotatePrompt fullscreen={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('drops the fullscreen button where the browser has none, or it is already on', () => {
    stubDevice(UPRIGHT_PHONE);
    render(<RotatePrompt fullscreen />);
    expect(screen.queryByRole('button', { name: 'Go fullscreen' })).toBeNull();
    cleanup();
    Object.defineProperty(document, 'fullscreenEnabled', { value: false, configurable: true });
    render(<RotatePrompt fullscreen={false} />);
    expect(screen.queryByRole('button', { name: 'Go fullscreen' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Play upright' })).toBeTruthy();
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
