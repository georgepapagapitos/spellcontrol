/**
 * Shared multi-file staging logic for the import surfaces (deck, collection,
 * binder). Pure — no React — so each panel can own its own state while sharing
 * the append / dedupe / cap rules.
 */

/** Most files that can be staged for a single batch import. */
export const MAX_STAGED_FILES = 10;

/** Returns `name` if free, else the next available "base (n).ext" variant. */
export function uniqueFileName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let n = 1;
  while (taken.has(`${base} (${n})${ext}`)) n++;
  return `${base} (${n})${ext}`;
}

export interface MergeStagedResult {
  files: File[];
  /** How many incoming files were renamed because their name collided. */
  renamed: number;
  /** How many incoming files were dropped because the cap was reached. */
  dropped: number;
}

/**
 * Appends `incoming` onto `existing`, renaming duplicate filenames to
 * "name (1).csv" copies and capping the total at `max`.
 */
export function mergeStagedFiles(
  existing: File[],
  incoming: File[],
  max = MAX_STAGED_FILES
): MergeStagedResult {
  const taken = new Set(existing.map((f) => f.name));
  const files = [...existing];
  let renamed = 0;
  let dropped = 0;
  for (const file of incoming) {
    if (files.length >= max) {
      dropped++;
      continue;
    }
    const finalName = uniqueFileName(file.name, taken);
    if (finalName !== file.name) {
      renamed++;
      files.push(new File([file], finalName, { type: file.type, lastModified: file.lastModified }));
    } else {
      files.push(file);
    }
    taken.add(finalName);
  }
  return { files, renamed, dropped };
}

/** Human-readable notice for renamed/dropped counts, or null if neither. */
export function stagedFilesNotice(
  renamed: number,
  dropped: number,
  max = MAX_STAGED_FILES
): string | null {
  const notes: string[] = [];
  if (renamed > 0) {
    notes.push(
      `${renamed} file${renamed === 1 ? '' : 's'} had a duplicate name and ${
        renamed === 1 ? 'was' : 'were'
      } added as a copy.`
    );
  }
  if (dropped > 0) {
    notes.push(
      `${dropped} file${dropped === 1 ? '' : 's'} skipped — you can stage up to ${max} at a time.`
    );
  }
  return notes.length > 0 ? notes.join(' ') : null;
}

/** Strips a file extension for use as a default deck/import name. */
export function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}
