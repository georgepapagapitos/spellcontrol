import { describe, expect, it, vi } from 'vitest';
import { isTransportNoise, userMessage } from './user-error';
import { logger } from './logger';

describe('userMessage', () => {
  it('passes authored copy through unchanged', () => {
    expect(userMessage(new Error('That trade was already answered.'), 'fallback')).toBe(
      'That trade was already answered.'
    );
    expect(userMessage(new Error("Couldn't add Sol Ring."), 'fallback')).toBe(
      "Couldn't add Sol Ring."
    );
  });

  it('replaces transport noise with the fallback', () => {
    for (const raw of [
      'Failed to fetch',
      'NetworkError when attempting to fetch resource.',
      'Load failed',
      'Request failed: HTTP 502',
      'EDHREC API error: 403 Forbidden',
      'Unexpected token < in JSON at position 0',
      'Unknown error',
      'The operation was aborted.',
      "Cannot read properties of undefined (reading 'id')",
      '',
      '   ',
    ]) {
      expect(userMessage(new Error(raw), "Couldn't load your trades. Try again."), raw).toBe(
        "Couldn't load your trades. Try again."
      );
    }
  });

  it('uses the fallback for non-Error throwables', () => {
    expect(userMessage('boom', 'fallback')).toBe('fallback');
    expect(userMessage(undefined, 'fallback')).toBe('fallback');
    expect(userMessage({ status: 500 }, 'fallback')).toBe('fallback');
  });

  it('keeps the raw error in the console', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const err = new Error('Failed to fetch');
    userMessage(err, 'fallback');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('error shown'), err);
    warn.mockRestore();
  });

  it('isTransportNoise ignores ordinary sentences that merely mention a number', () => {
    expect(isTransportNoise('Deck size 54 / 100 cards')).toBe(false);
    expect(isTransportNoise('You need at least 10 characters.')).toBe(false);
  });
});
