import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import type { TokenSummary } from "../../../shared/contracts";
import { TokenAvatar } from "../../components/TokenAvatar";
import {
  formatAge,
  formatCount,
  formatPercent,
  formatUsd,
  shortAddress,
} from "../../lib/format";

type SortKey =
  | "rank"
  | "priceUsd"
  | "marketCapUsd"
  | "liquidityUsd"
  | "volume24hUsd"
  | "priceChange24hPercent";

const columns: { key: SortKey; label: string }[] = [
  { key: "rank", label: "Rank" },
  { key: "priceUsd", label: "Price" },
  { key: "marketCapUsd", label: "Market cap" },
  { key: "liquidityUsd", label: "Liquidity" },
  { key: "volume24hUsd", label: "Volume 24h" }, // gitleaks:allow -- Table column metadata, not a credential.
  { key: "priceChange24hPercent", label: "24h" },
];

export function TokenTable({
  tokens,
  query,
}: {
  tokens: TokenSummary[];
  query: string;
}) {
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>(
    { key: "rank", direction: "asc" },
  );
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...tokens]
      .filter(
        (token) =>
          !needle ||
          [token.name, token.symbol, token.address].some((value) =>
            value.toLowerCase().includes(needle),
          ),
      )
      .sort((left, right) => {
        const leftValue =
          left[sort.key] ??
          (sort.direction === "asc"
            ? Number.POSITIVE_INFINITY
            : Number.NEGATIVE_INFINITY);
        const rightValue =
          right[sort.key] ??
          (sort.direction === "asc"
            ? Number.POSITIVE_INFINITY
            : Number.NEGATIVE_INFINITY);
        return (leftValue - rightValue) * (sort.direction === "asc" ? 1 : -1);
      });
  }, [query, sort, tokens]);

  function toggle(key: SortKey) {
    setSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  }

  return (
    <div className="table-card">
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {columns.slice(0, 1).map((column) => (
                <SortableHeader
                  key={column.key}
                  columnKey={column.key}
                  label={column.label}
                  sort={sort}
                  onSort={toggle}
                />
              ))}
              <th scope="col">Token</th>
              {columns.slice(1).map((column) => (
                <SortableHeader
                  key={column.key}
                  columnKey={column.key}
                  label={column.label}
                  sort={sort}
                  onSort={toggle}
                />
              ))}
              <th scope="col">Holders</th>
              <th scope="col">Listed</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((token) => (
              <tr key={token.address}>
                <td className="rank-cell">{token.rank ?? "—"}</td>
                <td>
                  <Link className="token-link" to={`/tokens/${token.address}`}>
                    <TokenAvatar
                      logoUrl={token.logoUrl}
                      symbol={token.symbol}
                    />
                    <span>
                      <strong>{token.symbol}</strong>
                      <small>
                        {token.name} · {shortAddress(token.address)}
                      </small>
                    </span>
                  </Link>
                </td>
                <td>{formatUsd(token.priceUsd)}</td>
                <td>{formatUsd(token.marketCapUsd)}</td>
                <td>{formatUsd(token.liquidityUsd)}</td>
                <td>{formatUsd(token.volume24hUsd)}</td>
                <td>
                  <Change value={token.priceChange24hPercent} />
                </td>
                <td>{formatCount(token.holders)}</td>
                <td>{formatAge(token.listedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length === 0 && (
        <p className="table-empty">No tokens match “{query}”.</p>
      )}
    </div>
  );
}

function SortableHeader({
  columnKey,
  label,
  sort,
  onSort,
}: {
  columnKey: SortKey;
  label: string;
  sort: { key: SortKey; direction: "asc" | "desc" };
  onSort: (key: SortKey) => void;
}) {
  const active = sort.key === columnKey;
  const Icon = !active
    ? ArrowUpDown
    : sort.direction === "asc"
      ? ArrowUp
      : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={
        active
          ? sort.direction === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
    >
      <button
        className="sort-button"
        onClick={() => {
          onSort(columnKey);
        }}
      >
        {label}
        <Icon size={12} aria-hidden="true" />
      </button>
    </th>
  );
}

export function Change({ value }: { value: number | null }) {
  return (
    <span
      className={
        value === null
          ? "muted"
          : value >= 0
            ? "change change--up"
            : "change change--down"
      }
    >
      {formatPercent(value)}
    </span>
  );
}
