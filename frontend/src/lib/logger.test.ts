import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from './logger';

// vitest runs with import.meta.env.DEV === true, so the dev-gated methods
// (debug/info/table) fire here just as they would in a dev build.
describe('logger', () => {
  afterEach(() => vi.restoreAllMocks());

  it('forwards debug to console.debug', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    logger.debug('hello', 1);
    expect(spy).toHaveBeenCalledWith('hello', 1);
  });

  it('forwards info to console.info', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    logger.info('x');
    expect(spy).toHaveBeenCalledWith('x');
  });

  it('forwards table to console.table', () => {
    const spy = vi.spyOn(console, 'table').mockImplementation(() => {});
    const rows = [{ a: 1 }];
    logger.table(rows);
    expect(spy).toHaveBeenCalledWith(rows);
  });

  it('forwards warn to console.warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logger.warn('careful', { code: 1 });
    expect(spy).toHaveBeenCalledWith('careful', { code: 1 });
  });

  it('forwards error to console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('boom');
    logger.error('failed', err);
    expect(spy).toHaveBeenCalledWith('failed', err);
  });
});
