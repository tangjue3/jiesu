export function App() {
  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <h1 className="mb-6 text-xl font-semibold">拖动</h1>
      <div className="flex items-center gap-4">
        <button className="rounded-md bg-blue-600 px-4 py-2 text-white">拖我</button>
        <span className="text-sm text-slate-500">拖左边这个按钮，它会跟着鼠标走</span>
      </div>
    </div>
  );
}
