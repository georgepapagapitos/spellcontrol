import { describe, it, expect, vi } from 'vitest';
import { preventFocusSteal } from './keyboard';

describe('preventFocusSteal', () => {
  it('calls preventDefault so the press does not blur the focused field', () => {
    const preventDefault = vi.fn();
    preventFocusSteal({ preventDefault });
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });
});
