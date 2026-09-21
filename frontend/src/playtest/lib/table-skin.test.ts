// @vitest-environment happy-dom
/**
 * The felt is a per-device preference, stored in localStorage and applied to
 * `<body>`. Two things matter beyond "it round-trips": a default writes
 * NOTHING (so the plain rules stay the default look, and a device that never
 * touched this carries no storage), and applying the look hands back an undo
 * — a board that unmounts must leave the rest of the app as it found it.
 *
 * Sleeves were removed: the picker tinted a card back nobody asked to tint,
 * and the tint outlives the picker unless it is actively cleaned up.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_FELT, FELTS, applyTableSkin, readFelt, skinLabel, writeFelt } from './table-skin';

beforeEach(() => {
  localStorage.clear();
  delete document.body.dataset.felt;
  delete document.body.dataset.sleeve;
});

describe('the remembered look', () => {
  it('starts on the default', () => {
    expect(readFelt()).toBe(DEFAULT_FELT);
  });

  it('round-trips a choice', () => {
    writeFelt('green');
    expect(readFelt()).toBe('green');
  });

  it('stores nothing for a default, so an untouched device carries none', () => {
    writeFelt('green');
    writeFelt(DEFAULT_FELT);
    expect(localStorage.length).toBe(0);
  });

  it('ignores a value that is not one of the options', () => {
    localStorage.setItem('playtest-felt-v1', 'tartan');
    expect(readFelt()).toBe(DEFAULT_FELT);
  });
});

describe('applyTableSkin', () => {
  it('puts the choice on the body and takes it off again', () => {
    const undo = applyTableSkin('blue');
    expect(document.body.dataset.felt).toBe('blue');
    undo();
    expect(document.body.dataset.felt).toBeUndefined();
  });

  it('writes no attribute for the default — the plain rules are the default look', () => {
    applyTableSkin(DEFAULT_FELT);
    expect(document.body.dataset.felt).toBeUndefined();
  });

  it('restores whatever was there before rather than clearing it', () => {
    document.body.dataset.felt = 'green';
    const undo = applyTableSkin('wine');
    expect(document.body.dataset.felt).toBe('wine');
    undo();
    expect(document.body.dataset.felt).toBe('green');
  });

  // The picker is gone, so a leftover tint would be permanent: nothing in the
  // UI could reach it any more.
  it('clears a sleeve left behind by a build that still had the picker', () => {
    document.body.dataset.sleeve = 'purple';
    localStorage.setItem('playtest-sleeve-v1', 'purple');
    applyTableSkin(DEFAULT_FELT);
    expect(document.body.dataset.sleeve).toBeUndefined();
    expect(localStorage.getItem('playtest-sleeve-v1')).toBeNull();
  });
});

describe('the option list', () => {
  it('leads with the default and has no duplicate ids', () => {
    expect(FELTS[0].id).toBe(DEFAULT_FELT);
    expect(new Set(FELTS.map((o) => o.id)).size).toBe(FELTS.length);
  });

  it('names the current choice, falling back to the default', () => {
    expect(skinLabel(FELTS, 'wine')).toBe('Wine');
    expect(skinLabel(FELTS, 'tartan')).toBe(FELTS[0].label);
  });
});
