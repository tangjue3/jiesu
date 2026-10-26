export function Hero() {
  return (
    <section className="grid grid-cols-12 gap-8 px-6 py-20">
      <div className="col-span-7">
        <h1 className="text-4xl font-bold leading-tight">一句话讲清你的产品</h1>
        <p className="mt-4 text-lg text-slate-600">用一句话说清楚你为谁解决什么问题。</p>
        <a href="/start" className="mt-6 inline-block rounded-md bg-blue-600 px-5 py-3 text-white">
          开始使用
        </a>
      </div>
      <div className="col-span-5">
        <img src="/hero.png" alt="产品截图" className="rounded-xl border border-slate-200" />
      </div>
    </section>
  );
}
