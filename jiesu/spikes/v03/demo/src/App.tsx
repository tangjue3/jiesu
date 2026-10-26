export function App() {
  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">图层</h1>
        <button className="rounded-md bg-blue-600 px-3 py-1 text-white">操作</button>
      </header>
      <section className="grid grid-cols-2 gap-4">
        <article className="rounded-lg bg-white p-4 shadow">
          <h2 className="text-sm font-medium">卡片一</h2>
          <p className="text-xs text-slate-500">说明文字</p>
        </article>
        <article className="rounded-lg bg-white p-4 shadow">
          <h2 className="text-sm font-medium">卡片二</h2>
          <p className="text-xs text-slate-500">说明文字</p>
        </article>
      </section>
    </div>
  );
}
