export function Item({ label, className }: { label: string; className?: string }) {
  return (
    <li className={`flex items-center gap-3 py-2 text-sm ${className ?? ''}`}>{label}</li>
  );
}

export function List() {
  return (
    <ul className="divide-y">
      <Item label="A" className="px-6" />
      <Item label="B" className="px-4" />
    </ul>
  );
}
