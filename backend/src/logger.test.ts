import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from './logger';

// vitest sets NODE_ENV to 'test' (not 'production'), so the dev-gated `debug`
// method fires here just as it would outside production.
describe('logger', () => {
  afterEach(() => vi.restoreAllMocks());

  it('forwards debug to console.debug', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    logger.debug('hello', 1);
    expect(spy).toHaveBeenCalledWith('hello', 1);
  });

  it('forwards info to console.info', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    logger.info('up');
    expect(spy).toHaveBeenCalledWith('up');
  });

  it('forwards warn to console.warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logger.warn('careful');
    expect(spy).toHaveBeenCalledWith('careful');
  });

  it('forwards error to console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('boom');
    logger.error('failed', err);
    expect(spy).toHaveBeenCalledWith('failed', err);
  });
});
