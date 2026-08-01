// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { useTypeSetStore, bootstrapTypeSet } from './typeset';
import { DEFAULT_TYPESET, TYPESETS } from '../lib/typesets';

const VALID = 'grimoire';
const INVALID = 'not-a-real-typeset';
const KEY = 'spellcontrol-typeset';

const dataTypeSet = () => document.documentElement.getAttribute('data-typeset');
const fontLink = () => document.getElementById('sc-typeset-fonts') as HTMLLinkElement | null;

beforeEach(() => {
  // Reset the store BEFORE clearing storage — persist writes on every set, so
  // the reverse order would leave a stored value behind and break the
  // first-run cases. Mirrors theme.test.ts.
  useTypeSetStore.setState({ typeset: DEFAULT_TYPESET });
  localStorage.clear();
  document.documentElement.removeAttribute('data-typeset');
  fontLink()?.remove();
});

describe('typeset store', () => {
  it('setTypeSet stamps data-typeset and persists', () => {
    useTypeSetStore.getState().setTypeSet(VALID);
    expect(useTypeSetStore.getState().typeset).toBe(VALID);
    expect(dataTypeSet()).toBe(VALID);
    expect(localStorage.getItem(KEY)).toContain(VALID);
  });

  it('setTypeSet ignores an unknown id', () => {
    useTypeSetStore.getState().setTypeSet(VALID);
    useTypeSetStore.getState().setTypeSet(INVALID);
    expect(useTypeSetStore.getState().typeset).toBe(VALID);
    expect(dataTypeSet()).toBe(VALID);
  });

  it('injects the font stylesheet for a non-default set', () => {
    useTypeSetStore.getState().setTypeSet(VALID);
    const link = fontLink();
    expect(link).not.toBeNull();
    expect(link!.rel).toBe('stylesheet');
    expect(link!.href).toBe(TYPESETS.find((t) => t.id === VALID)!.href);
  });

  it('reuses one link element across switches instead of stacking them', () => {
    useTypeSetStore.getState().setTypeSet(VALID);
    useTypeSetStore.getState().setTypeSet('broadsheet');
    expect(document.querySelectorAll('#sc-typeset-fonts')).toHaveLength(1);
    expect(fontLink()!.href).toBe(TYPESETS.find((t) => t.id === 'broadsheet')!.href);
  });

  it('removes the injected link when returning to the default set', () => {
    // The default's faces are linked statically in index.html; leaving ours
    // behind would keep a duplicate request for the same families alive.
    useTypeSetStore.getState().setTypeSet(VALID);
    expect(fontLink()).not.toBeNull();
    useTypeSetStore.getState().setTypeSet(DEFAULT_TYPESET);
    expect(fontLink()).toBeNull();
    expect(dataTypeSet()).toBe(DEFAULT_TYPESET);
  });

  it('injects no link for a set that needs no webfont', () => {
    useTypeSetStore.getState().setTypeSet('plain');
    expect(dataTypeSet()).toBe('plain');
    expect(fontLink()).toBeNull();
  });
});

describe('bootstrapTypeSet', () => {
  it('applies the default when nothing is stored', () => {
    bootstrapTypeSet();
    expect(dataTypeSet()).toBe(DEFAULT_TYPESET);
  });

  it('applies a stored set pre-paint', () => {
    localStorage.setItem(KEY, JSON.stringify({ state: { typeset: VALID }, version: 0 }));
    bootstrapTypeSet();
    expect(dataTypeSet()).toBe(VALID);
    expect(fontLink()).not.toBeNull();
  });

  it('falls back to the default for stored garbage', () => {
    localStorage.setItem(KEY, 'not json at all');
    bootstrapTypeSet();
    expect(dataTypeSet()).toBe(DEFAULT_TYPESET);
  });

  it('falls back to the default for a stored id no longer in the registry', () => {
    localStorage.setItem(KEY, JSON.stringify({ state: { typeset: INVALID }, version: 0 }));
    bootstrapTypeSet();
    expect(dataTypeSet()).toBe(DEFAULT_TYPESET);
  });
});
