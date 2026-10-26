export function Page() {
  return (
    <main className="flex flex-col gap-4 p-6">
      <div className="text-lg font-semibold">标题</div>
      <section className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border p-4">卡片一</div>
        <div className="rounded-lg border p-4">卡片二</div>
      </section>
      <div className="empty-slot"></div>
    </main>
  );
}
