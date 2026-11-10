import { AlertTriangle, Inbox, RefreshCw } from "lucide-react";

export function LoadingState({
  label = "Loading market data",
}: {
  label?: string;
}) {
  return (
    <div className="state-panel" role="status">
      <span className="spinner" aria-hidden="true" />
      <strong>{label}</strong>
      <p>Requesting normalized data from the Walletor API.</p>
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => void;
}) {
  return (
    <div className="state-panel state-panel--error" role="alert">
      <AlertTriangle aria-hidden="true" />
      <strong>Market data is unavailable</strong>
      <p>{error.message}</p>
      <button className="button button--secondary" onClick={onRetry}>
        <RefreshCw size={15} aria-hidden="true" /> Try again
      </button>
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="state-panel">
      <Inbox aria-hidden="true" />
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}
