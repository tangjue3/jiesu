export function Card() {
  return (
    <div className="rounded-lg border border-slate-200 p-4 text-slate-900 shadow-sm">
      <h2 className="text-lg font-semibold">标题</h2>
      <p className="mt-2 text-sm text-slate-600">正文内容</p>
      <button className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-white">按钮</button>
    </div>
  );
}
