export function Box({ large }: { large: boolean }) {
  return <div className={large ? 'p-8' : 'p-4'}>内容</div>;
}
