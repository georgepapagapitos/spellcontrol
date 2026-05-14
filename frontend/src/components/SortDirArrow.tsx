import type { SortDir } from '../types';

export function SortDirArrow({ dir }: { dir: SortDir }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {dir === 'asc' ? (
        <>
          <path d="M12 4v16" />
          <path d="m6 10 6-6 6 6" />
        </>
      ) : (
        <>
          <path d="M12 4v16" />
          <path d="m6 14 6 6 6-6" />
        </>
      )}
    </svg>
  );
}
