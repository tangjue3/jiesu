import { cn } from '@/lib/utils';

export function Chip({ active }: { active: boolean }) {
  return (
    <span className={cn('rounded-md px-2 py-1 text-xs', active && 'bg-blue-500')}>x</span>
  );
}
