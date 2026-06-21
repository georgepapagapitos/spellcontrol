import { describe, it, expect } from 'vitest';
import { errorMessage } from './error-utils.js';

describe('errorMessage', () => {
  it('returns the message from an Error instance', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('returns "Unknown error" for non-Error values', () => {
    expect(errorMessage('a string')).toBe('Unknown error');
    expect(errorMessage(42)).toBe('Unknown error');
    expect(errorMessage(null)).toBe('Unknown error');
    expect(errorMessage(undefined)).toBe('Unknown error');
    expect(errorMessage({ message: 'fake' })).toBe('Unknown error');
  });
});
