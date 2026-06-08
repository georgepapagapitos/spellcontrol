// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { classifyUndoRedoKey, isTextEntryTarget } from './use-undo-redo-keyboard';

type KeyParts = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey'>;

function ev(over: Partial<KeyParts>): KeyParts {
  return { key: 'z', metaKey: false, ctrlKey: false, shiftKey: false, ...over };
}

describe('classifyUndoRedoKey', () => {
  it('Cmd+Z → undo', () => {
    expect(classifyUndoRedoKey(ev({ key: 'z', metaKey: true }))).toBe('undo');
  });

  it('Ctrl+Z → undo', () => {
    expect(classifyUndoRedoKey(ev({ key: 'z', ctrlKey: true }))).toBe('undo');
  });

  it('Cmd+Shift+Z → redo', () => {
    expect(classifyUndoRedoKey(ev({ key: 'z', metaKey: true, shiftKey: true }))).toBe('redo');
  });

  it('Ctrl+Y → redo', () => {
    expect(classifyUndoRedoKey(ev({ key: 'y', ctrlKey: true }))).toBe('redo');
  });

  it('Cmd+Y → null (y requires ctrl, not meta)', () => {
    expect(classifyUndoRedoKey(ev({ key: 'y', metaKey: true }))).toBeNull();
  });

  it('plain z (no modifier) → null', () => {
    expect(classifyUndoRedoKey(ev({ key: 'z' }))).toBeNull();
  });

  it('uppercase Z still classifies (key is lowercased)', () => {
    expect(classifyUndoRedoKey(ev({ key: 'Z', metaKey: true }))).toBe('undo');
  });

  it('other keys → null', () => {
    expect(classifyUndoRedoKey(ev({ key: 'a', metaKey: true }))).toBeNull();
    expect(classifyUndoRedoKey(ev({ key: 's', ctrlKey: true }))).toBeNull();
  });
});

describe('isTextEntryTarget', () => {
  it('input → true', () => {
    expect(isTextEntryTarget(document.createElement('input'))).toBe(true);
  });

  it('textarea → true', () => {
    expect(isTextEntryTarget(document.createElement('textarea'))).toBe(true);
  });

  it('contentEditable element → true', () => {
    const el = document.createElement('div');
    el.contentEditable = 'true';
    expect(isTextEntryTarget(el)).toBe(true);
  });

  it('plain div → false', () => {
    expect(isTextEntryTarget(document.createElement('div'))).toBe(false);
  });

  it('null → false', () => {
    expect(isTextEntryTarget(null)).toBe(false);
  });
});
