export function App() {
  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <h1 className="mb-6 text-xl font-semibold">拖拽重排</h1>
      <div className="flex gap-4">
        <div className="w-40 rounded-lg bg-white p-4 shadow">第一张</div>
        <div className="w-40 rounded-lg bg-white p-4 shadow">第二张</div>
        <div className="w-40 rounded-lg bg-white p-4 shadow">第三张</div>
      </div>
      <div className="mt-8 flex flex-col gap-2">
        <p className="text-sm">纵向一</p>
        <p className="text-sm">纵向二</p>
      </div>
    </div>
  );
}
