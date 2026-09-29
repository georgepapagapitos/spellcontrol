// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StagedFileList } from './StagedFileList';

function file(name: string): File {
  return new File(['x'], name, { type: 'text/plain' });
}

describe('StagedFileList', () => {
  it('renders nothing when no files are staged', () => {
    const { container } = render(
      <StagedFileList files={[]} onRemove={() => {}} onClear={() => {}} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('pluralizes the count on max, not the current file count', () => {
    // 1 staged but the cap is 10 → "1 of 10 files" (the bug produced "file").
    render(
      <StagedFileList files={[file('a.csv')]} max={10} onRemove={() => {}} onClear={() => {}} />
    );
    expect(screen.getByText(/1 of 10 files staged/)).toBeTruthy();
  });

  it('uses the singular only when the cap itself is one', () => {
    render(
      <StagedFileList files={[file('a.csv')]} max={1} onRemove={() => {}} onClear={() => {}} />
    );
    expect(screen.getByText(/1 of 1 file staged/)).toBeTruthy();
  });

  it('stays plural at the cap', () => {
    render(
      <StagedFileList
        files={[file('a.csv'), file('b.csv')]}
        max={2}
        onRemove={() => {}}
        onClear={() => {}}
      />
    );
    expect(screen.getByText(/2 of 2 files staged/)).toBeTruthy();
  });

  it('wires per-file remove and clear-all callbacks', () => {
    const onRemove = vi.fn();
    const onClear = vi.fn();
    render(
      <StagedFileList
        files={[file('a.csv'), file('b.csv')]}
        max={10}
        onRemove={onRemove}
        onClear={onClear}
      />
    );
    fireEvent.click(screen.getByLabelText('Remove b.csv'));
    expect(onRemove).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByText('Clear'));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
