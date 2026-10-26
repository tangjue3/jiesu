export function Toast({ message }: { message: string }) {
  return (
    <div style={{ padding: '16px', color: '#333' }} className="fixed bottom-4">
      {message}
    </div>
  );
}
