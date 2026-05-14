import { ArrowDown, ArrowUp } from 'lucide-react';
import type { SortDir } from '../types';

export function SortDirArrow({ dir }: { dir: SortDir }) {
  const Icon = dir === 'asc' ? ArrowUp : ArrowDown;
  return <Icon width={14} height={14} strokeWidth={2} aria-hidden />;
}
