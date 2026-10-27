export function App() {
  return (
    <div className="min-h-screen bg-slate-50 px-6 py-12">
      <main className="mx-auto max-w-2xl">
        <header className="flex items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <h1 className="text-xl font-semibold text-slate-900">Studio 画布</h1>
          <span className="rounded-full bg-blue-50 px-3 py-1 text-xs text-blue-700">示例站点</span>
        </header>
        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="text-base font-semibold text-slate-900">这一块可以改</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            选中它、改间距、拖位置，改动会直接写回 src/App.tsx，右侧代码页能看到每一行变化。
          </p>
        </section>
      </main>
    </div>
  );
}
