export function Navbar() {
  return (
    <nav className="flex items-center justify-between gap-4 px-6 py-4">
      <a href="/" className="text-lg font-semibold">
        品牌
      </a>
      <div className="flex items-center gap-3">
        <a href="/docs" className="text-sm text-slate-600">
          文档
        </a>
        <a href="/login" className="text-sm text-slate-600">
          登录
        </a>
      </div>
    </nav>
  );
}
