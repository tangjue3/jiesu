export function CardGrid() {
  return (
    <div className="grid grid-cols-3 gap-6 px-6 py-10">
      <article className="rounded-lg border border-slate-200 p-4">
        <h3 className="text-lg font-semibold">标题</h3>
        <p className="mt-2 text-sm text-slate-600">描述</p>
      </article>
      <article className="rounded-lg border border-slate-200 p-4">
        <h3 className="text-lg font-semibold">标题</h3>
        <p className="mt-2 text-sm text-slate-600">描述</p>
      </article>
      <article className="rounded-lg border border-slate-200 p-4">
        <h3 className="text-lg font-semibold">标题</h3>
        <p className="mt-2 text-sm text-slate-600">描述</p>
      </article>
    </div>
  );
}
