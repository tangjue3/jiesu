export function Toast({ message }: { message: string }) {
  return (
    <div style={{ padding: '24px', color: '#333' }} className="fixed bottom-4">
      {message}
    </div>
  );
}
