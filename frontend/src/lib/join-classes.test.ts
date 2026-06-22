import { describe, expect, it } from 'vitest';
import { joinClasses } from './join-classes';

describe('joinClasses', () => {
  it('joins two class names', () => {
    expect(joinClasses('foo', 'bar')).toBe('foo bar');
  });

  it('filters out false', () => {
    expect(joinClasses('foo', false, 'bar')).toBe('foo bar');
  });

  it('filters out undefined', () => {
    expect(joinClasses('foo', undefined, 'bar')).toBe('foo bar');
  });

  it('returns empty string when all falsy', () => {
    expect(joinClasses(false, undefined)).toBe('');
  });

  it('works with a single class', () => {
    expect(joinClasses('only')).toBe('only');
  });

  it('handles conditional class pattern', () => {
    const isActive = true;
    const isDisabled = false;
    expect(joinClasses('base', isActive && 'active', isDisabled && 'disabled')).toBe('base active');
  });
});
