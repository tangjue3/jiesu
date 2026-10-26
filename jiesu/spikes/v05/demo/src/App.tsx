export function App() {
  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <main className="mx-auto max-w-2xl rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">结构编辑</h1>
        <p className="mt-1 text-sm text-slate-600">插入、删除、复制都会重排同级元素的锚点。</p>
        <div className="mt-4 flex flex-col gap-3">
          <div className="rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-700">第一块</div>
          <div className="rounded-md bg-slate-100 px-4 py-3 text-sm text-slate-700">第二块</div>
        </div>
      </main>
    </div>
  );
}
