export function ContactForm() {
  return (
    <form className="mx-auto flex max-w-md flex-col gap-4 px-6 py-10">
      <label className="flex flex-col gap-2 text-sm">
        邮箱
        <input className="rounded-md border border-slate-300 px-3 py-2" type="email" />
      </label>
      <label className="flex flex-col gap-2 text-sm">
        留言
        <textarea className="rounded-md border border-slate-300 px-3 py-2" rows={4} />
      </label>
      <button className="rounded-md bg-blue-600 px-4 py-2 text-white">发送</button>
    </form>
  );
}
