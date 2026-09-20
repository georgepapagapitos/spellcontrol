// @vitest-environment happy-dom
/**
 * E347: the felt and the sleeves are per-device, stored in localStorage and
 * applied to `<body>`. Two things matter beyond "it round-trips": a default
 * writes NOTHING (so the plain rules stay the default look, and a device that
 * never touched this carries no storage), and applying the look hands back an
 * undo — a board that unmounts must leave the rest of the app as it found it.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_FELT,
  DEFAULT_SLEEVE,
  FELTS,
  SLEEVES,
  applyTableSkin,
  readFelt,
  readSleeve,
  skinLabel,
  writeFelt,
  writeSleeve,
} from './table-skin';

beforeEach(() => {
  localStorage.clear();
  delete document.body.dataset.felt;
  delete document.body.dataset.sleeve;
});

describe('the remembered look', () => {
  it('starts on the defaults', () => {
    expect(readFelt()).toBe(DEFAULT_FELT);
    expect(readSleeve()).toBe(DEFAULT_SLEEVE);
  });

  it('round-trips a choice', () => {
    writeFelt('green');
    writeSleeve('purple');
    expect(readFelt()).toBe('green');
    expect(readSleeve()).toBe('purple');
  });

  it('stores nothing for a default, so an untouched device carries none', () => {
    writeFelt('green');
    writeFelt(DEFAULT_FELT);
    writeSleeve(DEFAULT_SLEEVE);
    expect(localStorage.length).toBe(0);
  });

  it('ignores a value that is not one of the options', () => {
    localStorage.setItem('playtest-felt-v1', 'tartan');
    expect(readFelt()).toBe(DEFAULT_FELT);
  });
});

describe('applyTableSkin', () => {
  it('puts the choice on the body and takes it off again', () => {
    const undo = applyTableSkin('blue', 'red');
    expect(document.body.dataset.felt).toBe('blue');
    expect(document.body.dataset.sleeve).toBe('red');
    undo();
    expect(document.body.dataset.felt).toBeUndefined();
    expect(document.body.dataset.sleeve).toBeUndefined();
  });

  it('writes no attribute for a default — the plain rules are the default look', () => {
    applyTableSkin(DEFAULT_FELT, 'red');
    expect(document.body.dataset.felt).toBeUndefined();
    expect(document.body.dataset.sleeve).toBe('red');
  });

  it('restores whatever was there before rather than clearing it', () => {
    document.body.dataset.felt = 'green';
    const undo = applyTableSkin('wine', DEFAULT_SLEEVE);
    expect(document.body.dataset.felt).toBe('wine');
    undo();
    expect(document.body.dataset.felt).toBe('green');
  });
});

describe('the option lists', () => {
  it('lead with the default and have no duplicate ids', () => {
    expect(FELTS[0].id).toBe(DEFAULT_FELT);
    expect(SLEEVES[0].id).toBe(DEFAULT_SLEEVE);
    for (const list of [FELTS, SLEEVES]) {
      expect(new Set(list.map((o) => o.id)).size).toBe(list.length);
    }
  });

  it('names the current choice, falling back to the default', () => {
    expect(skinLabel(SLEEVES, 'purple')).toBe('Purple');
    expect(skinLabel(FELTS, 'tartan')).toBe(FELTS[0].label);
  });
});
