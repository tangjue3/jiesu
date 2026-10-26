export function App() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <nav className="flex items-center justify-between gap-4 px-6 py-4">
        <span className="text-lg font-semibold">Jiesu Demo</span>
        <div className="flex items-center gap-3">
          <a href="/docs" className="text-sm text-slate-600">
            文档
          </a>
          <button className="rounded-md bg-blue-600 px-4 py-2 text-white">开始使用</button>
        </div>
      </nav>

      <main className="grid grid-cols-3 gap-6 px-6 py-10">
        <article className="rounded-lg border border-slate-200 p-4">
          <h3 className="text-lg font-semibold">卡片一</h3>
          <p className="mt-2 text-sm text-slate-600">描述文字</p>
        </article>
        <article className="rounded-lg border border-slate-200 p-4">
          <h3 className="text-lg font-semibold">卡片二</h3>
          <p className="mt-2 text-sm text-slate-600">描述文字</p>
        </article>
        <article className="rounded-lg border border-slate-200 p-4">
          <h3 className="text-lg font-semibold">卡片三</h3>
          <p className="mt-2 text-sm text-slate-600">描述文字</p>
        </article>
      </main>
    </div>
  );
}
