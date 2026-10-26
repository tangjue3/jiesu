export function SidebarLayout() {
  return (
    <div className="flex min-h-screen">
      <aside className="w-64 shrink-0 border-r border-slate-200 bg-slate-50 p-4">
        <nav className="flex flex-col gap-2">
          <a href="/a" className="text-sm">
            概览
          </a>
          <a href="/b" className="text-sm">
            设置
          </a>
        </nav>
      </aside>
      <main className="flex-1 p-6">
        <h2 className="text-xl font-semibold">内容区</h2>
      </main>
    </div>
  );
}
