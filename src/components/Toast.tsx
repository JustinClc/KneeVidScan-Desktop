export function Toast({ message }: { message: string | null }) {
  return (
    <div className={`toast${message ? ' show' : ''}`} role="status">
      {message}
    </div>
  );
}
