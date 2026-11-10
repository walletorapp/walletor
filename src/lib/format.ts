export function formatUsd(value: number | null): string {
  if (value === null) return "—";
  if (Math.abs(value) < 0.000001 && value !== 0)
    return `$${value.toExponential(2)}`;
  if (Math.abs(value) < 0.01)
    return `$${value.toLocaleString("en-US", { maximumFractionDigits: 8 })}`;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: Math.abs(value) >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(value) < 1 ? 4 : 2,
  }).format(value);
}

export function formatCount(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatPercent(value: number | null): string {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function formatAge(value: string | null): string {
  if (!value) return "—";
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 1_000),
  );
  if (seconds < 60) return `${String(seconds)}s`;
  if (seconds < 3_600) return `${String(Math.floor(seconds / 60))}m`;
  if (seconds < 86_400) return `${String(Math.floor(seconds / 3_600))}h`;
  return `${String(Math.floor(seconds / 86_400))}d`;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 5)}…${address.slice(-5)}`;
}
