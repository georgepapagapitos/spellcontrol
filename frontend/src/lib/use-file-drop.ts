import { useCallback, useRef, useState } from 'react';

export interface FileDropProps {
  onDragEnter: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

/**
 * Drag-and-drop file staging, shared by the deck/collection/binder import
 * surfaces. Tracks enter/leave depth so nested children don't flicker the
 * overlay, and only reacts to actual file drags.
 *
 * Spread `dropProps` onto the drop target and toggle a dragover style with
 * `isDragging`.
 */
export function useFileDrop(
  onFiles: (files: File[]) => void,
  options: { disabled?: boolean } = {}
): { isDragging: boolean; dropProps: FileDropProps } {
  const { disabled = false } = options;
  const [isDragging, setIsDragging] = useState(false);
  const depth = useRef(0);

  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');

  const onDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (disabled || !hasFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      setIsDragging(true);
    },
    [disabled]
  );

  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      if (disabled || !hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    [disabled]
  );

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setIsDragging(false);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      depth.current = 0;
      setIsDragging(false);
      if (disabled) return;
      const files = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
      if (files.length > 0) onFiles(files);
    },
    [disabled, onFiles]
  );

  return { isDragging, dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}
