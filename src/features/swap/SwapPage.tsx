import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownUp,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  ExternalLink,
  LoaderCircle,
  Search,
  Settings2,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import type { VerifiedSwapCreditResult } from "../../../shared/accounting-contracts";
import type { WalletHolding } from "../../../shared/contracts";
import type { SwapOrder } from "../../../shared/swap-contracts";
import { HowItWorksButton } from "../../components/HowItWorksButton";
import { segmentoRuntime } from "../affiliates/segmento-runtime";
import { formatUsd as formatTokenPrice } from "../../lib/format";
import {
  fetchDiscoveryTokens,
  fetchRwaAssets,
  fetchWalletBalance,
  fetchWalletHoldings,
  searchSwapTokens,
} from "../../lib/api";
import {
  fetchSwapOrder,
  retrySwapAccounting,
  submitSignedSwap,
} from "../../lib/swap";
import {
  formatParticipantCount,
  formatUsdCents,
  roundClock,
} from "../prize-pool/presentation";
import {
  PrizePoolAmount,
  PrizePoolFundingNote,
} from "../prize-pool/DailyPrizePromotion";
import {
  prizePoolQueryKey,
  usePrizePoolState,
} from "../prize-pool/usePrizePoolState";
import { WalletorEnginePage } from "../rewards/WalletorEnginePage";
import { walletEngineQueryKey } from "../rewards/useWalletEngineState";
import {
  loadSwapHistory,
  saveSwapHistory,
  type SwapHistoryEntry,
} from "./history";
import { fractionOfAvailableBalance } from "./max-spend";
import { OPEN_TOKEN_SEARCH_EVENT } from "./events";
import { RewardCelebrationModal } from "./RewardCelebrationModal";
import { SwapConnectButton } from "./SwapConnectButton";
import { QuestlineNotice } from "./QuestlineNotice";
import { shouldCelebrateReward } from "./reward-celebration";
import {
  rewardReconciliationRetry,
  rewardSyncCountdownSeconds,
} from "./reward-reconciliation";
import {
  DEFAULT_MINIMUM_REWARD_USD,
  isBelowMinimumRewardValue,
} from "./reward-eligibility";
import {
  additionalExecutionFeeLabel,
  platformFeeLabel,
  swapFeeBreakdown,
} from "./fees";
import {
  fromAtomicAmount,
  rwaAssetToSwapToken,
  SOL_TOKEN,
  SWAP_TOKENS,
  toAtomicAmount,
  type SwapToken,
  USDC_TOKEN,
} from "./tokens";

const QUOTE_LIFETIME_MS = 20_000;
const MAX_AUTOMATIC_QUOTE_REFRESHES = 5;
const SOL_LOW_BALANCE_WARNING_THRESHOLD = 500_000n;
const BALANCE_REFRESH_DELAYS_MS = [0, 500, 1_000, 2_000] as const;
const LIVE_BALANCE_REFRESH_DEBOUNCE_MS = 250;
const LIVE_BALANCE_POLL_INTERVAL_MS = 15_000;

function quoteExpirationMs(order: SwapOrder, fetchedAt: number): number {
  if (!order.expireAt) return fetchedAt + QUOTE_LIFETIME_MS;

  const numericExpiration = Number(order.expireAt);
  if (Number.isFinite(numericExpiration) && numericExpiration > 0) {
    return numericExpiration > 1_000_000_000_000
      ? numericExpiration
      : numericExpiration * 1_000;
  }

  const parsedExpiration = Date.parse(order.expireAt);
  return Number.isFinite(parsedExpiration)
    ? parsedExpiration
    : fetchedAt + QUOTE_LIFETIME_MS;
}

interface BalanceSnapshot {
  inputBalance: string | null;
  solBalance: string | null;
}

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function base64FromBytes(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function tokenFromSearch(
  result: Awaited<ReturnType<typeof searchSwapTokens>>[number],
): SwapToken {
  return {
    symbol: result.symbol,
    name: result.name,
    mint: result.address,
    decimals: result.decimals,
    color: "linear-gradient(135deg, #2b67ac, #10b981)",
    logoUrl: result.logoUrl,
    isVerified: result.isVerified,
    organicScore: result.organicScore,
    organicScoreLabel: result.organicScoreLabel,
    priceUsd: result.priceUsd,
    liquidityUsd: result.liquidityUsd,
    marketCapUsd: result.marketCapUsd,
    holders: result.holders,
    mintAuthorityDisabled: result.mintAuthorityDisabled,
    freezeAuthorityDisabled: result.freezeAuthorityDisabled,
    topHoldersPercent: result.topHoldersPercent,
    source: result.source,
    discoveredAt: result.discoveredAt,
  };
}

function tokenFromHolding(holding: WalletHolding): SwapToken {
  const knownToken = SWAP_TOKENS.find((item) => item.mint === holding.mint);
  if (knownToken) {
    return {
      ...knownToken,
      logoUrl: holding.logoUrl ?? knownToken.logoUrl,
      priceUsd: holding.priceUsd ?? knownToken.priceUsd,
    };
  }
  return {
    symbol: holding.symbol,
    name: holding.name,
    mint: holding.mint,
    decimals: holding.decimals,
    color: "linear-gradient(135deg, #2563eb, #22d3ee)",
    logoUrl: holding.logoUrl,
    isVerified: false,
    organicScore: null,
    organicScoreLabel: null,
    priceUsd: holding.priceUsd,
    liquidityUsd: null,
    marketCapUsd: null,
    holders: null,
    mintAuthorityDisabled: null,
    freezeAuthorityDisabled: null,
    topHoldersPercent: null,
    source: "jupiter",
    discoveredAt: null,
  };
}

function formatHoldingAmount(holding: WalletHolding): string {
  const units = fromAtomicAmount(holding.amount, holding.decimals);
  const numeric = Number(units);
  if (!Number.isFinite(numeric)) return units;
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: numeric < 1 ? 6 : 4,
    notation: numeric >= 1_000_000 ? "compact" : "standard",
  }).format(numeric);
}

function formatHoldingUsd(holding: WalletHolding): string {
  if (holding.priceUsd === null) return "Value unavailable";
  const units = Number(fromAtomicAmount(holding.amount, holding.decimals));
  const estimate = units * holding.priceUsd;
  return Number.isFinite(estimate) ? formatUsd(estimate) : "Value unavailable";
}

function tokenSafetyLabel(token: SwapToken): string {
  if (!token.isVerified) return "Unverified";
  if (token.organicScoreLabel === "low") return "Low activity";
  if (
    token.mintAuthorityDisabled === false ||
    token.freezeAuthorityDisabled === false
  ) {
    return "Authority active";
  }
  return "VERIFIED";
}

function rewardReceiptLabel(
  receipt: VerifiedSwapCreditResult,
  minimumRewardUsd: string,
): string {
  if (receipt.rewardEligible) {
    return `+${receipt.wltPointsCredited} WALLETOR TOKENS EARNED`;
  }
  if (receipt.eligibilityReason === "BELOW_MINIMUM_SWAP_VALUE") {
    return `Swap confirmed · below $${minimumRewardUsd} minimum · no Prize Pool entry or WLT`;
  }
  const reason = "backend verification incomplete";
  return `Swap confirmed · no WLT (${reason})`;
}

interface TokenWarning {
  title: string;
  description: string;
}

function tokenWarnings(token: SwapToken): TokenWarning[] {
  const warnings: TokenWarning[] = [];
  if (!token.isVerified) {
    warnings.push({
      title: "Not Verified",
      description:
        "This token is not verified. Confirm the mint address before trading.",
    });
  }
  if (token.organicScoreLabel === "low") {
    warnings.push({
      title: "Low Organic Activity",
      description:
        "Jupiter reports low organic trading activity for this token.",
    });
  }
  if (token.mintAuthorityDisabled === false) {
    warnings.push({
      title: "Mint Authority Active",
      description: "The token creator can still issue additional supply.",
    });
  }
  if (token.freezeAuthorityDisabled === false) {
    warnings.push({
      title: "Freeze Authority Active",
      description: "The token creator may be able to freeze token accounts.",
    });
  }
  return warnings;
}

function TokenWarningsDisclosure({
  token,
  warnings,
}: {
  token: SwapToken;
  warnings: TokenWarning[];
}) {
  const countLabel = `${String(warnings.length)} ${warnings.length === 1 ? "Warning" : "Warnings"}`;

  return (
    <details
      className="token-warning-disclosure"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.currentTarget.removeAttribute("open");
        event.currentTarget.querySelector("summary")?.focus();
      }}
    >
      <summary
        aria-label={`Show ${countLabel.toLowerCase()} for ${token.symbol}`}
      >
        <ShieldAlert aria-hidden="true" />
        <span>{countLabel}</span>
        <ChevronDown className="token-warning-chevron" aria-hidden="true" />
      </summary>
      <div
        className="token-warning-popover"
        role="group"
        aria-label={`${countLabel} for ${token.symbol}`}
      >
        <strong className="token-warning-heading">{countLabel}</strong>
        <ul>
          {warnings.map((warning) => (
            <li key={warning.title}>
              <CircleAlert aria-hidden="true" />
              <span>
                <strong>{warning.title}</strong>
                <small>{warning.description}</small>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

function TokenIcon({ token }: { token: SwapToken }) {
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);
  const visibleLogoUrl =
    token.logoUrl && token.logoUrl !== failedLogoUrl ? token.logoUrl : null;

  return visibleLogoUrl ? (
    <img
      className="token-icon"
      src={visibleLogoUrl}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => {
        setFailedLogoUrl(visibleLogoUrl);
      }}
    />
  ) : (
    <span className="token-icon" style={{ background: token.color }}>
      {token.symbol.slice(0, 1)}
    </span>
  );
}

function normalizedOfficialAssetTerm(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function isExactOfficialAssetSearch(token: SwapToken, query: string): boolean {
  const normalizedQuery = normalizedOfficialAssetTerm(query);
  if (!normalizedQuery || !token.ticker) return false;

  const companyWithoutShareClass = token.name.replace(/\s+class\s+[a-z]$/i, "");
  return [
    token.name,
    companyWithoutShareClass,
    token.ticker,
    token.symbol,
  ].some((term) => normalizedOfficialAssetTerm(term) === normalizedQuery);
}

function matchesVerifiedRwaSearch(token: SwapToken, query: string): boolean {
  const normalizedQuery = normalizedOfficialAssetTerm(query);
  if (!normalizedQuery) return true;

  return [token.name, token.ticker ?? "", token.symbol, token.mint].some(
    (term) => normalizedOfficialAssetTerm(term).includes(normalizedQuery),
  );
}

type TokenCategory = "holdings" | "popular" | "verified" | "stocks";

function TokenPicker({
  token,
  onChange,
  onVerifiedRwaSelect,
  market = "crypto",
  curatedTokens = [],
  respondToHeaderSearch = false,
  openRequest = false,
  onOpenRequestHandled,
}: {
  token: SwapToken;
  onChange: (token: SwapToken, context: { preferSolPair: boolean }) => void;
  onVerifiedRwaSelect?: (token: SwapToken) => void;
  market?: "crypto" | "rwa";
  curatedTokens?: SwapToken[];
  respondToHeaderSearch?: boolean;
  openRequest?: boolean;
  onOpenRequestHandled?: () => void;
}) {
  const { publicKey } = useWallet();
  const walletAddress = publicKey?.toBase58() ?? null;
  const [open, setOpen] = useState(openRequest);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SwapToken[]>([]);
  const [discoveries, setDiscoveries] = useState<SwapToken[]>([]);
  const [holdingsResult, setHoldingsResult] = useState<{
    owner: string;
    holdings: WalletHolding[];
  } | null>(null);
  const [category, setCategory] = useState<TokenCategory>("popular");
  const [searchLoading, setSearchLoading] = useState(false);
  const [discoveryLoading, setDiscoveryLoading] = useState(openRequest);
  const [holdingsLoading, setHoldingsLoading] = useState(false);
  const [holdingsError, setHoldingsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickerViewport, setPickerViewport] = useState<{
    top: number;
    height: number;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const backdropPressRef = useRef(false);
  const officialRwaRegistry = useQuery({
    queryKey: ["rwa-assets"],
    queryFn: ({ signal }) => fetchRwaAssets(signal),
    enabled: open && market === "crypto",
    staleTime: 60_000,
  });
  const verifiedRwaTokens = useMemo(
    () => (officialRwaRegistry.data?.assets ?? []).map(rwaAssetToSwapToken),
    [officialRwaRegistry.data?.assets],
  );
  const officialRwaMatches = useMemo(
    () =>
      verifiedRwaTokens.filter((item) =>
        isExactOfficialAssetSearch(item, query),
      ),
    [query, verifiedRwaTokens],
  );
  const verifiedRwaSearchResults = useMemo(
    () =>
      verifiedRwaTokens.filter((item) => matchesVerifiedRwaSearch(item, query)),
    [query, verifiedRwaTokens],
  );
  const isOfficialRwaQuery = officialRwaMatches.length > 0;

  const openPicker = useCallback(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body
        ? document.activeElement
        : null;
    setDiscoveryLoading(true);
    setHoldingsLoading(Boolean(walletAddress));
    setHoldingsResult(null);
    setHoldingsError(null);
    setCategory(walletAddress ? "holdings" : "popular");
    setOpen(true);
  }, [walletAddress]);

  const closePicker = useCallback(() => {
    backdropPressRef.current = false;
    setOpen(false);
    onOpenRequestHandled?.();
    if (returnFocusRef.current?.isConnected) {
      returnFocusRef.current.focus();
    } else {
      triggerRef.current?.focus();
    }
  }, [onOpenRequestHandled]);

  useEffect(() => {
    if (!respondToHeaderSearch) return;
    window.addEventListener(OPEN_TOKEN_SEARCH_EVENT, openPicker);
    return () => {
      window.removeEventListener(OPEN_TOKEN_SEARCH_EVENT, openPicker);
    };
  }, [openPicker, respondToHeaderSearch]);

  useEffect(() => {
    if (!open) return;
    if (market === "rwa") return;
    const controller = new AbortController();
    void fetchDiscoveryTokens("all", controller.signal)
      .then((tokens) => {
        setDiscoveries(tokens.map(tokenFromSearch));
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError")
          return;
        setError(
          caught instanceof Error ? caught.message : "Token discovery failed.",
        );
      })
      .finally(() => {
        setDiscoveryLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [market, open]);

  useEffect(() => {
    if (!open || !walletAddress) return;
    const controller = new AbortController();
    void fetchWalletHoldings(walletAddress, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setHoldingsResult(result);
        setHoldingsError(null);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        if (caught instanceof DOMException && caught.name === "AbortError")
          return;
        setHoldingsError(
          caught instanceof Error
            ? caught.message
            : "Wallet holdings are temporarily unavailable.",
        );
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setHoldingsLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [open, walletAddress]);

  useEffect(() => {
    if (!open) return;
    const normalized = query.trim();
    if (!normalized) return;
    if (market === "rwa" || category === "stocks") return;
    if (
      isOfficialRwaQuery ||
      officialRwaRegistry.isFetching ||
      officialRwaRegistry.isError ||
      !officialRwaRegistry.data
    ) {
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setSearchLoading(true);
      void searchSwapTokens(normalized, controller.signal)
        .then((tokens) => {
          setResults(tokens.map(tokenFromSearch));
          setError(tokens.length ? null : "No matching Solana tokens.");
        })
        .catch((caught: unknown) => {
          if (caught instanceof DOMException && caught.name === "AbortError")
            return;
          setError(
            caught instanceof Error ? caught.message : "Token search failed.",
          );
        })
        .finally(() => {
          setSearchLoading(false);
        });
    }, 300);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [
    isOfficialRwaQuery,
    category,
    market,
    officialRwaRegistry.data,
    officialRwaRegistry.isError,
    officialRwaRegistry.isFetching,
    open,
    query,
  ]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePicker();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [closePicker, open]);

  useEffect(() => {
    if (!open) return;

    const visualViewport = window.visualViewport;
    const updatePickerViewport = () => {
      setPickerViewport({
        top: Math.max(0, Math.round(visualViewport?.offsetTop ?? 0)),
        height: Math.max(
          1,
          Math.round(visualViewport?.height ?? window.innerHeight),
        ),
      });
    };

    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    updatePickerViewport();
    visualViewport?.addEventListener("resize", updatePickerViewport);
    visualViewport?.addEventListener("scroll", updatePickerViewport);
    window.addEventListener("resize", updatePickerViewport);

    return () => {
      visualViewport?.removeEventListener("resize", updatePickerViewport);
      visualViewport?.removeEventListener("scroll", updatePickerViewport);
      window.removeEventListener("resize", updatePickerViewport);
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [open]);

  const rwaSearchResults = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return [...SWAP_TOKENS, ...curatedTokens].filter((item) =>
      [item.symbol, item.name, item.ticker ?? "", item.mint].some((value) =>
        value.toLowerCase().includes(needle),
      ),
    );
  }, [curatedTokens, query]);
  const approvedRwaUniverse = [...SWAP_TOKENS, ...curatedTokens];
  const approvedRwaByMint = new Map(
    approvedRwaUniverse.map((item) => [item.mint, item]),
  );
  const holdings =
    holdingsResult?.owner === walletAddress ? holdingsResult.holdings : [];
  const holdingTokens = holdings
    .map((holding) =>
      market === "rwa"
        ? (approvedRwaByMint.get(holding.mint) ?? null)
        : tokenFromHolding(holding),
    )
    .filter((item): item is SwapToken => item !== null);
  const effectiveCategory =
    !walletAddress && category === "holdings" ? "popular" : category;
  const showingVerifiedStocks =
    market === "crypto" && effectiveCategory === "stocks";
  const quickTokens = showingVerifiedStocks
    ? verifiedRwaTokens.slice(0, 3)
    : market === "rwa"
      ? curatedTokens.slice(0, 3)
      : SWAP_TOKENS;
  const availableTokens = (() => {
    if (query.trim()) {
      if (market === "rwa") return rwaSearchResults;
      if (showingVerifiedStocks) return verifiedRwaSearchResults;
      return isOfficialRwaQuery ? officialRwaMatches : results;
    }
    if (showingVerifiedStocks) return verifiedRwaTokens;
    if (effectiveCategory === "holdings") return holdingTokens;
    if (effectiveCategory === "popular") {
      return market === "rwa" ? curatedTokens : SWAP_TOKENS;
    }
    return market === "rwa"
      ? SWAP_TOKENS
      : [...SWAP_TOKENS, ...discoveries].filter((item) => item.isVerified);
  })();
  const visibleTokens = [
    ...new Map(availableTokens.map((item) => [item.mint, item])).values(),
  ];
  const loading =
    market === "rwa"
      ? effectiveCategory === "holdings" && !query.trim()
        ? holdingsLoading
        : false
      : showingVerifiedStocks
        ? officialRwaRegistry.isFetching
        : query.trim()
          ? officialRwaRegistry.isFetching || searchLoading
          : effectiveCategory === "holdings"
            ? holdingsLoading
            : discoveryLoading;
  const holdingByMint = new Map(holdings.map((item) => [item.mint, item]));
  const showingHoldings = !query.trim() && effectiveCategory === "holdings";
  const visibleError =
    market === "crypto" &&
    (showingVerifiedStocks || query.trim()) &&
    officialRwaRegistry.isError
      ? "Verified stock registry is temporarily unavailable. Try again before searching."
      : isOfficialRwaQuery
        ? null
        : error;

  const selectToken = (item: SwapToken) => {
    if (
      market === "crypto" &&
      item.assetCategory !== undefined &&
      onVerifiedRwaSelect
    ) {
      closePicker();
      setQuery("");
      onVerifiedRwaSelect(item);
      return;
    }
    onChange(item, {
      preferSolPair: respondToHeaderSearch || query.trim().length > 0,
    });
    closePicker();
    setQuery("");
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="token-select"
        aria-label={`Choose token, currently ${token.symbol}`}
        onClick={openPicker}
      >
        <TokenIcon token={token} />
        <strong>{token.symbol}</strong>
        <ChevronDown size={17} aria-hidden="true" />
      </button>
      {open
        ? createPortal(
            <div
              className="token-modal-backdrop"
              role="presentation"
              style={
                pickerViewport
                  ? {
                      top: `${String(pickerViewport.top)}px`,
                      bottom: "auto",
                      height: `${String(pickerViewport.height)}px`,
                    }
                  : undefined
              }
              onPointerDown={(event) => {
                backdropPressRef.current =
                  event.button === 0 && event.target === event.currentTarget;
              }}
              onPointerCancel={() => {
                backdropPressRef.current = false;
              }}
              onClick={(event) => {
                if (
                  backdropPressRef.current &&
                  event.target === event.currentTarget
                ) {
                  closePicker();
                }
                backdropPressRef.current = false;
              }}
            >
              <section
                className={`token-modal${query.trim() ? " token-modal--searching" : ""}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby="token-modal-title"
              >
                <h2 id="token-modal-title" className="sr-only">
                  {market === "rwa"
                    ? "Choose a verified stock or payment asset"
                    : "Choose a Solana token"}
                </h2>
                <header className="token-modal__search-header">
                  <label className="token-search-field">
                    <Search size={20} aria-hidden="true" />
                    <input
                      autoFocus
                      autoCapitalize="none"
                      autoComplete="off"
                      enterKeyHint="done"
                      inputMode="search"
                      spellCheck={false}
                      value={query}
                      placeholder={
                        market === "rwa"
                          ? "Search company, ticker, or verified mint"
                          : showingVerifiedStocks
                            ? "Search verified stocks by company, ticker, or mint"
                            : "Search tokens or paste a mint"
                      }
                      onChange={(event) => {
                        setQuery(event.target.value);
                        setResults([]);
                        setError(null);
                      }}
                    />
                    {loading && <LoaderCircle className="spin" size={18} />}
                  </label>
                  <button
                    type="button"
                    className="token-modal__escape"
                    aria-label="Close token selector"
                    onClick={() => {
                      closePicker();
                    }}
                  >
                    <span>Esc</span>
                    <X aria-hidden="true" />
                  </button>
                </header>

                <div
                  className="token-quick-list"
                  aria-label={
                    market === "rwa" || showingVerifiedStocks
                      ? "Popular tokenized stocks"
                      : "Popular tokens"
                  }
                >
                  {quickTokens.map((item) => (
                    <button
                      type="button"
                      key={item.mint}
                      aria-label={`Select ${item.symbol}`}
                      onClick={() => {
                        selectToken(item);
                      }}
                    >
                      <TokenIcon token={item} />
                      <span>{item.symbol}</span>
                    </button>
                  ))}
                </div>

                <div className="token-category-tabs" role="tablist">
                  {walletAddress && (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={effectiveCategory === "holdings"}
                      className={
                        effectiveCategory === "holdings" ? "active" : ""
                      }
                      onClick={() => {
                        setCategory("holdings");
                      }}
                    >
                      Holdings
                    </button>
                  )}
                  <button
                    type="button"
                    role="tab"
                    aria-selected={effectiveCategory === "popular"}
                    className={effectiveCategory === "popular" ? "active" : ""}
                    onClick={() => {
                      setCategory("popular");
                    }}
                  >
                    {market === "rwa" ? "Stocks" : "Popular"}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={effectiveCategory === "verified"}
                    className={effectiveCategory === "verified" ? "active" : ""}
                    onClick={() => {
                      setCategory("verified");
                    }}
                  >
                    {market === "rwa" ? "Pay with" : "Verified"}
                  </button>
                  {market === "crypto" ? (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={effectiveCategory === "stocks"}
                      className={effectiveCategory === "stocks" ? "active" : ""}
                      onClick={() => {
                        setCategory("stocks");
                        setQuery("");
                        setResults([]);
                        setError(null);
                      }}
                    >
                      Stocks
                    </button>
                  ) : null}
                </div>

                {visibleError && (
                  <p className="token-search-error">{visibleError}</p>
                )}
                {walletAddress && holdingsError && (
                  <p className="token-search-error">{holdingsError}</p>
                )}
                <div className="token-results">
                  {visibleTokens.map((item) => {
                    const holding = walletAddress
                      ? holdingByMint.get(item.mint)
                      : undefined;
                    return (
                      <button
                        type="button"
                        key={item.mint}
                        onClick={() => {
                          selectToken(item);
                        }}
                      >
                        <TokenIcon token={item} />
                        <span>
                          <strong>
                            {item.symbol}
                            {item.isVerified && (
                              <i
                                title={
                                  market === "rwa" ||
                                  item.assetCategory !== undefined
                                    ? "Verified RWA mint by Walletor"
                                    : "Verified by Jupiter"
                                }
                              >
                                <Check size={11} />
                              </i>
                            )}
                            {item.assetCategory !== undefined && (
                              <em className="token-source-badge token-source-badge--rwa">
                                Verified stock
                              </em>
                            )}
                            {item.source === "pumpfun" && (
                              <em className="token-source-badge">Pump.fun</em>
                            )}
                          </strong>
                          <small>
                            {item.ticker ? `${item.ticker} · ` : ""}
                            {item.name} · {item.mint.slice(0, 4)}…
                            {item.mint.slice(-4)}
                          </small>
                        </span>
                        {holding ? (
                          <span className="token-result-holding">
                            <strong>
                              {formatHoldingAmount(holding)} {item.symbol}
                            </strong>
                            <small>
                              {formatHoldingUsd({
                                ...holding,
                                priceUsd: holding.priceUsd ?? item.priceUsd,
                              })}
                            </small>
                          </span>
                        ) : (
                          <span className="token-result-safety">
                            <strong>
                              {item.assetCategory !== undefined
                                ? "Coming soon"
                                : item.priceUsd === null
                                  ? tokenSafetyLabel(item)
                                  : `${formatTokenPrice(item.priceUsd)} / token`}
                            </strong>
                            <small>
                              {item.assetCategory !== undefined
                                ? "Verified stock"
                                : tokenSafetyLabel(item)}
                            </small>
                          </span>
                        )}
                      </button>
                    );
                  })}
                  {!loading && visibleTokens.length === 0 && (
                    <p className="token-results-empty">
                      {showingHoldings
                        ? "No token balances found in this wallet."
                        : "No tokens found in this category."}
                    </p>
                  )}
                </div>
                <p className="token-risk-note">
                  {market === "rwa" ||
                  showingVerifiedStocks ||
                  isOfficialRwaQuery
                    ? "Verified stocks are discovery-only and coming soon. Only exact mints in Walletor’s RWA registry appear here."
                    : "Anyone can create a token. Verify the mint and review unverified assets carefully."}
                </p>
              </section>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function formatUsd(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: string | null): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  if (Math.abs(parsed) < 0.0001) return "<0.0001";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 4,
  }).format(parsed);
}

function routeSummary(
  order: SwapOrder,
  jupiterzRouteBadgeEnabled = false,
): string {
  if (jupiterzRouteBadgeEnabled && order.router?.toLowerCase() === "jupiterz") {
    return "JupiterZ RFQ";
  }
  const labels = [...new Set(order.routePlan.map((leg) => leg.label))];
  if (labels.length === 0) return order.router ?? "Jupiter";
  return labels.join(" → ");
}

function formatNetworkCost(order: SwapOrder): string {
  if (order.gasless) return "Gasless";
  const lamports = [
    order.signatureFeeLamports,
    order.prioritizationFeeLamports,
    order.rentFeeLamports,
  ].reduce<bigint>((total, value) => total + BigInt(value ?? "0"), 0n);
  if (lamports === 0n) return "Shown in wallet";
  return `${fromAtomicAmount(String(lamports), 9)} SOL est.`;
}

function orderBuildMessage(order: SwapOrder, inputSymbol: string): string {
  const router = order.router?.toLowerCase() ?? "";
  if (router === "jupiterz") {
    if (order.errorCode === 1)
      return `Your ${inputSymbol} balance changed. Refresh the amount and try again.`;
    if (order.errorCode === 2)
      return "JupiterZ could not use the required token account. Try the refreshed route again.";
    if (order.errorCode === 3)
      return "JupiterZ could not build this quote. Walletor requested another router, but no executable route is currently available.";
  }
  if (["metis", "dflow", "okx"].includes(router)) {
    if (order.errorCode === 1)
      return `Your ${inputSymbol} balance changed. Refresh the amount and try again.`;
    if (order.errorCode === 2)
      return "Add a small amount of SOL for network fees, then try again.";
    if (order.errorCode === 3)
      return "This amount is below Jupiter's current minimum. Enter a larger amount and try again.";
  }
  return order.errorMessage
    ? `Jupiter could not build the transaction: ${order.errorMessage}`
    : "Jupiter could quote this swap but no executable route is currently available. Refresh and try again.";
}

export function SwapPage({
  embeddedConcept = false,
  market = "crypto",
  curatedTokens = [],
  tradingEnabled: tradingAllowed = true,
  tradingDisabledMessage: disabledMessage = null,
  jupiterzRouteBadgeEnabled = false,
  initialOutputMint,
}: {
  embeddedConcept?: boolean;
  market?: "crypto" | "rwa";
  curatedTokens?: SwapToken[];
  tradingEnabled?: boolean;
  tradingDisabledMessage?: string | null;
  jupiterzRouteBadgeEnabled?: boolean;
  initialOutputMint?: string;
}) {
  const { connection } = useConnection();
  const { publicKey, signTransaction, connected } = useWallet();
  const connectedWalletAddress = publicKey?.toBase58() ?? null;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const prizePool = usePrizePoolState();
  const [searchParams, setSearchParams] = useSearchParams();
  const historyView = searchParams.get("view") === "history";
  const tokenSearchRequested = searchParams.get("tokenSearch") === "open";
  const requestedRwaMint = searchParams.get("asset");
  const requestedLaunchMint =
    market === "crypto"
      ? (initialOutputMint ?? searchParams.get("outputMint"))
      : null;
  const [launchSelection, setLaunchSelection] = useState<{
    mint: string;
    selected: boolean;
    error: string | null;
  } | null>(null);
  const launchBlocked = Boolean(
    requestedLaunchMint &&
    (launchSelection?.mint !== requestedLaunchMint ||
      !launchSelection.selected),
  );
  const tradingEnabled = tradingAllowed && !launchBlocked;
  const tradingDisabledMessage = launchBlocked
    ? (launchSelection?.error ?? "Loading the selected token…")
    : disabledMessage;
  const handleTokenSearchRequest = useCallback(() => {
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete("tokenSearch");
    setSearchParams(nextSearchParams, { replace: true });
  }, [searchParams, setSearchParams]);
  const [inputToken, setInputToken] = useState(SOL_TOKEN);
  const [outputToken, setOutputToken] = useState(USDC_TOKEN);
  const rwaPairInitialized = useRef(false);
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<{
    key: string;
    order: SwapOrder;
    fetchedAt: number;
  } | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [submissionPhase, setSubmissionPhase] = useState<
    "idle" | "wallet" | "swapping"
  >("idle");
  const submitting = submissionPhase !== "idle";
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [swapConfirmationVisible, setSwapConfirmationVisible] = useState(false);
  const [rewardReceipt, setRewardReceipt] =
    useState<
      Awaited<ReturnType<typeof submitSignedSwap>>["walletorAccounting"]
    >(null);
  const [accountingStatus, setAccountingStatus] = useState<
    "IDLE" | "SYNCING" | "DELAYED" | "CREDITED" | "NOT_ELIGIBLE"
  >("IDLE");
  const [rewardSyncStartedAt, setRewardSyncStartedAt] = useState<number | null>(
    null,
  );
  const [celebrationReceipt, setCelebrationReceipt] =
    useState<VerifiedSwapCreditResult | null>(null);
  const [history, setHistory] = useState<SwapHistoryEntry[]>(loadSwapHistory);
  const [inputBalance, setInputBalance] = useState<string | null>(null);
  const [solBalance, setSolBalance] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const balanceSnapshotRef = useRef<BalanceSnapshot>({
    inputBalance: null,
    solBalance: null,
  });
  const balanceContextRef = useRef({ owner: "", inputMint: "" });
  const balanceRefreshSequenceRef = useRef(0);
  const liveBalanceRefreshTimeoutRef = useRef<number | null>(null);
  const [clock, setClock] = useState(0);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [automaticQuoteRefresh, setAutomaticQuoteRefresh] = useState({
    quoteKey: "",
    completed: 0,
  });
  const openVerifiedRwaTrade = useCallback(
    (selected: SwapToken) => {
      void navigate(`/stocks-rwa?asset=${encodeURIComponent(selected.mint)}`);
    },
    [navigate],
  );

  useEffect(() => {
    const initialRwaToken =
      curatedTokens.find((item) => item.mint === requestedRwaMint) ??
      curatedTokens[0];
    if (market !== "rwa" || rwaPairInitialized.current || !initialRwaToken) {
      return;
    }
    rwaPairInitialized.current = true;
    setInputToken(USDC_TOKEN);
    setOutputToken(initialRwaToken);
    setAmount("");
    setQuote(null);
  }, [curatedTokens, market, requestedRwaMint]);

  useEffect(() => {
    if (!requestedLaunchMint || launchSelection?.mint === requestedLaunchMint)
      return;
    const controller = new AbortController();
    const resolve = async () => {
      try {
        new PublicKey(requestedLaunchMint);
        const results = await searchSwapTokens(
          requestedLaunchMint,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        const exact = results.find(
          (token) => token.address === requestedLaunchMint,
        );
        if (!exact)
          throw new Error(
            "This token is not available yet. Return to Trenches and try again shortly.",
          );
        setInputToken(
          exact.address === SOL_TOKEN.mint ? USDC_TOKEN : SOL_TOKEN,
        );
        setOutputToken(tokenFromSearch(exact));
        setAmount("");
        setQuote(null);
        setLaunchSelection({
          mint: requestedLaunchMint,
          selected: true,
          error: null,
        });
      } catch {
        if (!controller.signal.aborted)
          setLaunchSelection({
            mint: requestedLaunchMint,
            selected: false,
            error:
              "The selected token could not be loaded. Return to Trenches and try again shortly.",
          });
      }
    };
    void resolve();
    return () => {
      controller.abort();
    };
  }, [requestedLaunchMint, launchSelection?.mint]);

  useEffect(() => {
    if (
      market === "rwa" ||
      !signature ||
      rewardReceipt ||
      accountingStatus === "NOT_ELIGIBLE"
    ) {
      return;
    }
    const controller = new AbortController();
    const isCancelled = () => controller.signal.aborted;
    let timeoutId: number | null = null;
    let attempt = 0;
    const reconcile = async () => {
      if (isCancelled()) return;
      attempt += 1;
      try {
        const status = await retrySwapAccounting(signature);
        const receipt = status.walletorAccounting;
        if (isCancelled()) return;
        if (receipt) {
          setRewardReceipt(receipt);
          setAccountingStatus("CREDITED");
          setRewardSyncStartedAt(null);
          if (shouldCelebrateReward(receipt)) {
            setCelebrationReceipt(receipt);
          }
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: prizePoolQueryKey }),
            ...(publicKey
              ? [
                  queryClient.invalidateQueries({
                    queryKey: walletEngineQueryKey(publicKey.toBase58()),
                  }),
                ]
              : []),
          ]);
          return;
        }
      } catch {
        // The on-chain swap is already confirmed. Keep reconciliation running
        // without presenting a successful swap as a failed transaction.
      }
      if (isCancelled()) return;
      const retry = rewardReconciliationRetry(attempt);
      setAccountingStatus(retry.status);
      timeoutId = window.setTimeout(() => {
        void reconcile();
      }, retry.delayMs);
    };
    void reconcile();
    return () => {
      controller.abort();
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [
    accountingStatus,
    market,
    publicKey,
    queryClient,
    rewardReceipt,
    signature,
  ]);

  const poolState = prizePool.data;
  const serverClockOffsetMs = poolState
    ? Date.parse(poolState.serverTime) - prizePool.dataUpdatedAt
    : 0;
  const activeRoundClock = poolState
    ? roundClock(
        poolState.activeRound.startTime,
        poolState.activeRound.endTime,
        clock + serverClockOffsetMs,
      )
    : null;
  const poolStatusLabel = prizePool.isError
    ? "Temporarily unavailable"
    : !poolState
      ? "Loading…"
      : poolState.accountingStatus === "LIVE"
        ? "Distributed by Walletor AI"
        : poolState.accountingStatus === "PAUSED"
          ? "Accounting paused"
          : poolState.accountingStatus === "SYNCING"
            ? "Data syncing"
            : "Accounting not live";

  const atomicAmount = useMemo(
    () => toAtomicAmount(amount, inputToken.decimals),
    [amount, inputToken.decimals],
  );
  const hasPositiveAmount = atomicAmount !== null && atomicAmount !== "0";
  const quoteKey = `${connectedWalletAddress ?? "quote-only"}:${inputToken.mint}:${outputToken.mint}:${atomicAmount ?? ""}`;
  const automaticQuoteRefreshCount =
    automaticQuoteRefresh.quoteKey === quoteKey
      ? automaticQuoteRefresh.completed
      : 0;
  const activeQuote = quote?.key === quoteKey ? quote : null;
  const minimumRewardUsd =
    poolState?.transparency.rewardEligibility.minimumEligibleSwapUsd ??
    DEFAULT_MINIMUM_REWARD_USD;
  const belowMinimumReward = activeQuote
    ? isBelowMinimumRewardValue(activeQuote.order, minimumRewardUsd)
    : null;
  const quoteFees = activeQuote ? swapFeeBreakdown(activeQuote.order) : null;
  const quoteAdditionalFee = activeQuote
    ? additionalExecutionFeeLabel(activeQuote.order)
    : null;
  const quotedOutput = activeQuote
    ? fromAtomicAmount(activeQuote.order.outAmount, outputToken.decimals)
    : null;
  const quoteAge = activeQuote ? clock - activeQuote.fetchedAt : 0;
  const quoteExpiresAt = activeQuote
    ? quoteExpirationMs(activeQuote.order, activeQuote.fetchedAt)
    : null;
  const quoteExpired = quoteExpiresAt !== null && clock >= quoteExpiresAt;
  const priceImpactPercent = activeQuote
    ? Number(activeQuote.order.priceImpactPct)
    : 0;
  const highPriceImpact =
    Number.isFinite(priceImpactPercent) && priceImpactPercent >= 1;
  const outputRiskWarnings = tokenWarnings(outputToken);
  const insufficientBalance = Boolean(
    atomicAmount && inputBalance && BigInt(atomicAmount) > BigInt(inputBalance),
  );
  const lowSolForFees = Boolean(
    connected &&
    solBalance &&
    BigInt(solBalance) < SOL_LOW_BALANCE_WARNING_THRESHOLD,
  );
  const hasValidQuote = Boolean(
    activeQuote &&
    !quoteExpired &&
    activeQuote.order.errorCode === null &&
    (!connected || activeQuote.order.transaction !== null),
  );
  const tradeUnavailable =
    !tradingEnabled ||
    insufficientBalance ||
    (hasPositiveAmount && !quoteLoading && !hasValidQuote);
  const quoteReady = hasValidQuote && !tradeUnavailable;
  const primaryActionLabel = !connected
    ? "Connect / Swap"
    : !tradingEnabled
      ? "Trading unavailable"
      : insufficientBalance
        ? "Insufficient"
        : tradeUnavailable
          ? "Quote unavailable"
          : "Swap";
  const rewardSyncSeconds =
    rewardSyncStartedAt === null
      ? null
      : rewardSyncCountdownSeconds(
          rewardSyncStartedAt,
          Math.max(clock, rewardSyncStartedAt),
        );
  const closeRewardCelebration = useCallback(() => {
    setCelebrationReceipt(null);
  }, []);
  const dismissCompletedSwapFeedback = useCallback(() => {
    setSwapConfirmationVisible(false);
    setCelebrationReceipt(null);
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => {
      setClock(Date.now());
    }, 0);
    const interval = window.setInterval(() => {
      setClock(Date.now());
    }, 1_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, []);

  const refreshBalances = useCallback(async (): Promise<BalanceSnapshot> => {
    if (!publicKey) {
      balanceRefreshSequenceRef.current += 1;
      balanceContextRef.current = { owner: "", inputMint: "" };
      balanceSnapshotRef.current = {
        inputBalance: null,
        solBalance: null,
      };
      setInputBalance(null);
      setSolBalance(null);
      return { inputBalance: null, solBalance: null };
    }
    const owner = publicKey.toBase58();
    const sequence = balanceRefreshSequenceRef.current + 1;
    balanceRefreshSequenceRef.current = sequence;
    const previousContext = balanceContextRef.current;
    if (
      previousContext.owner !== owner ||
      previousContext.inputMint !== inputToken.mint
    ) {
      const nextSnapshot = {
        inputBalance: null,
        solBalance:
          previousContext.owner === owner
            ? balanceSnapshotRef.current.solBalance
            : null,
      };
      balanceContextRef.current = { owner, inputMint: inputToken.mint };
      balanceSnapshotRef.current = nextSnapshot;
      setInputBalance(null);
      if (previousContext.owner !== owner) setSolBalance(null);
    }
    if (balanceSnapshotRef.current.inputBalance === null) {
      setBalanceLoading(true);
    }
    try {
      const balance = await fetchWalletBalance(owner, inputToken.mint);
      const nextSolBalance = balance.solAmount;
      const nextInputBalance = balance.inputAmount;
      const nextSnapshot = {
        inputBalance: nextInputBalance,
        solBalance: nextSolBalance,
      };
      if (sequence !== balanceRefreshSequenceRef.current) {
        return balanceSnapshotRef.current;
      }
      balanceSnapshotRef.current = nextSnapshot;
      setSolBalance(nextSolBalance);
      setInputBalance(nextInputBalance);
      return nextSnapshot;
    } catch (caught: unknown) {
      console.warn("Wallet balance refresh failed.", caught);
      return balanceSnapshotRef.current;
    } finally {
      if (sequence === balanceRefreshSequenceRef.current) {
        setBalanceLoading(false);
      }
    }
  }, [inputToken.mint, publicKey]);

  const requestLiveBalanceRefresh = useCallback(() => {
    if (!publicKey || document.visibilityState !== "visible") return;
    if (liveBalanceRefreshTimeoutRef.current !== null) return;
    liveBalanceRefreshTimeoutRef.current = window.setTimeout(() => {
      liveBalanceRefreshTimeoutRef.current = null;
      void refreshBalances();
    }, LIVE_BALANCE_REFRESH_DEBOUNCE_MS);
  }, [publicKey, refreshBalances]);

  const refreshBalancesAfterSwap = useCallback(
    async (before: BalanceSnapshot): Promise<void> => {
      for (const delayMs of BALANCE_REFRESH_DELAYS_MS) {
        if (delayMs > 0) {
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, delayMs);
          });
        }
        const latest = await refreshBalances();
        if (
          latest.inputBalance !== before.inputBalance ||
          latest.solBalance !== before.solBalance
        ) {
          return;
        }
      }
    },
    [refreshBalances],
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refreshBalances();
    }, 0);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [refreshBalances]);

  useEffect(() => {
    if (!publicKey) return;
    const subscriptionId = connection.onAccountChange(
      publicKey,
      requestLiveBalanceRefresh,
      { commitment: "confirmed" },
    );
    return () => {
      void connection
        .removeAccountChangeListener(subscriptionId)
        .catch((caught: unknown) => {
          console.warn("Wallet balance subscription cleanup failed.", caught);
        });
    };
  }, [connection, publicKey, requestLiveBalanceRefresh]);

  useEffect(() => {
    if (!publicKey) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        requestLiveBalanceRefresh();
      }
    };
    const interval = window.setInterval(
      refreshWhenVisible,
      LIVE_BALANCE_POLL_INTERVAL_MS,
    );
    window.addEventListener("focus", refreshWhenVisible);
    window.addEventListener("pageshow", refreshWhenVisible);
    window.addEventListener("online", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
      window.removeEventListener("pageshow", refreshWhenVisible);
      window.removeEventListener("online", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [publicKey, requestLiveBalanceRefresh]);

  useEffect(() => {
    return () => {
      if (liveBalanceRefreshTimeoutRef.current !== null) {
        window.clearTimeout(liveBalanceRefreshTimeoutRef.current);
        liveBalanceRefreshTimeoutRef.current = null;
      }
    };
  }, [requestLiveBalanceRefresh]);

  useEffect(() => {
    if (!tradingEnabled || !hasPositiveAmount || !atomicAmount) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setQuoteLoading(true);
      setError(null);
      void fetchSwapOrder({
        market,
        inputMint: inputToken.mint,
        outputMint: outputToken.mint,
        amount: atomicAmount,
        taker: connectedWalletAddress ?? undefined,
        signal: controller.signal,
      })
        .then((order) => {
          setQuote({ key: quoteKey, order, fetchedAt: Date.now() });
          setError(null);
        })
        .catch((caught: unknown) => {
          if (caught instanceof DOMException && caught.name === "AbortError")
            return;
          setError(
            caught instanceof Error ? caught.message : "Quote unavailable.",
          );
        })
        .finally(() => {
          setQuoteLoading(false);
        });
    }, 450);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [
    atomicAmount,
    connectedWalletAddress,
    hasPositiveAmount,
    inputToken.mint,
    market,
    outputToken.mint,
    quoteKey,
    refreshNonce,
    tradingEnabled,
  ]);

  useEffect(() => {
    if (
      !activeQuote ||
      quoteLoading ||
      submitting ||
      automaticQuoteRefreshCount >= MAX_AUTOMATIC_QUOTE_REFRESHES
    ) {
      return;
    }

    const refreshDelayMs = Math.max(
      0,
      quoteExpirationMs(activeQuote.order, activeQuote.fetchedAt) - Date.now(),
    );
    const timeout = window.setTimeout(() => {
      setQuoteLoading(true);
      setAutomaticQuoteRefresh((current) => ({
        quoteKey,
        completed: current.quoteKey === quoteKey ? current.completed + 1 : 1,
      }));
      setRefreshNonce((value) => value + 1);
    }, refreshDelayMs);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    activeQuote,
    automaticQuoteRefreshCount,
    quoteKey,
    quoteLoading,
    submitting,
  ]);

  const setFraction = async (numerator: bigint, denominator: bigint) => {
    const latestBalance =
      inputBalance ?? (await refreshBalances()).inputBalance;
    if (latestBalance === null) {
      setError("Wallet balance is temporarily unavailable. Try again.");
      return;
    }
    const available = BigInt(latestBalance);
    const selected = fractionOfAvailableBalance(
      available,
      numerator,
      denominator,
      inputToken.mint === SOL_TOKEN.mint,
    );
    dismissCompletedSwapFeedback();
    setAmount(fromAtomicAmount(String(selected), inputToken.decimals));
    setError(null);
  };

  const reversePair = () => {
    dismissCompletedSwapFeedback();
    setInputToken(outputToken);
    setOutputToken(inputToken);
    setAmount(quotedOutput ?? "");
    setQuote(null);
    setError(null);
  };

  const submitSwap = async () => {
    if (
      !tradingEnabled ||
      !publicKey ||
      !signTransaction ||
      !atomicAmount ||
      atomicAmount === "0" ||
      insufficientBalance
    )
      return;
    const balancesBefore: BalanceSnapshot = { inputBalance, solBalance };
    const reportSegmentoSwap = segmentoRuntime.swapReporter(
      publicKey.toBase58(),
    );
    setSubmissionPhase("wallet");
    setError(null);
    setSwapConfirmationVisible(false);
    setCelebrationReceipt(null);
    setSignature(null);
    setRewardReceipt(null);
    setAccountingStatus("IDLE");
    setRewardSyncStartedAt(null);
    try {
      if (inputBalance === null) void refreshBalances();
      const order = await fetchSwapOrder({
        market,
        inputMint: inputToken.mint,
        outputMint: outputToken.mint,
        amount: atomicAmount,
        taker: publicKey.toBase58(),
      });
      if (
        inputBalance !== null &&
        BigInt(atomicAmount) > BigInt(inputBalance)
      ) {
        throw new Error(
          `Your ${inputToken.symbol} balance changed after the last update. Enter a smaller amount and try again.`,
        );
      }
      if (!order.transaction) {
        throw new Error(orderBuildMessage(order, inputToken.symbol));
      }
      const transaction = VersionedTransaction.deserialize(
        bytesFromBase64(order.transaction),
      );
      const signed = await signTransaction(transaction);
      setSubmissionPhase("swapping");
      const result = await submitSignedSwap({
        signedTransaction: base64FromBytes(signed.serialize()),
        requestId: order.requestId,
        market,
        taker: publicKey.toBase58(),
        lastValidBlockHeight: order.lastValidBlockHeight ?? undefined,
      });
      if (result.status !== "Success" || !result.signature) {
        throw new Error(result.error ?? "The swap did not confirm.");
      }
      reportSegmentoSwap(result);
      const entry: SwapHistoryEntry = {
        signature: result.signature,
        confirmedAt: new Date().toISOString(),
        wallet: publicKey.toBase58(),
        inputToken: {
          symbol: inputToken.symbol,
          mint: inputToken.mint,
        },
        outputToken: {
          symbol: outputToken.symbol,
          mint: outputToken.mint,
        },
        inputAmount: fromAtomicAmount(
          result.totalInputAmount ?? result.inputAmountResult ?? order.inAmount,
          inputToken.decimals,
        ),
        outputAmount: fromAtomicAmount(
          result.totalOutputAmount ??
            result.outputAmountResult ??
            order.outAmount,
          outputToken.decimals,
        ),
        inputUsdValue: order.inUsdValue,
      };
      const nextHistory = [
        entry,
        ...history.filter((item) => item.signature !== entry.signature),
      ].slice(0, 50);
      setHistory(nextHistory);
      saveSwapHistory(nextHistory);
      setSignature(result.signature);
      setSwapConfirmationVisible(true);
      const verifiedReceipt = result.walletorAccounting;
      setRewardReceipt(verifiedReceipt);
      setAccountingStatus(
        market === "rwa"
          ? "NOT_ELIGIBLE"
          : verifiedReceipt
            ? "CREDITED"
            : order.referralAccount === null
              ? "NOT_ELIGIBLE"
              : "SYNCING",
      );
      setRewardSyncStartedAt(
        market === "crypto" &&
          !verifiedReceipt &&
          order.referralAccount !== null
          ? Date.now()
          : null,
      );
      if (market === "crypto" && shouldCelebrateReward(verifiedReceipt)) {
        setCelebrationReceipt(verifiedReceipt);
      }
      setAmount("");
      setQuote(null);
      setRefreshNonce((value) => value + 1);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: prizePoolQueryKey }),
        queryClient.invalidateQueries({
          queryKey: walletEngineQueryKey(publicKey.toBase58()),
        }),
      ]);
      await refreshBalancesAfterSwap(balancesBefore);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The swap failed.");
    } finally {
      setSubmissionPhase("idle");
    }
  };

  return (
    <>
      <div
        className={`swap-page${embeddedConcept ? " swap-page--concept" : ""}`}
      >
        {!embeddedConcept && (
          <div className="revenue-column">
            <section
              className="revenue-hero"
              aria-labelledby="revenue-pool-heading"
            >
              <div className="revenue-hero__topline">
                <span className="revenue-eyebrow">
                  <i /> WIN FROM THE POOL
                </span>
              </div>

              <div className="revenue-orbit" aria-label={poolStatusLabel}>
                <div className="revenue-orbit__ring">
                  <h1 id="revenue-pool-heading">
                    <i /> Prize pool
                  </h1>
                  <strong>
                    {poolState ? (
                      <PrizePoolAmount state={poolState} />
                    ) : prizePool.isError ? (
                      "—"
                    ) : (
                      "Loading…"
                    )}
                  </strong>
                  <PrizePoolFundingNote state={poolState} />
                  <small>
                    <i /> {poolStatusLabel}
                  </small>
                </div>
              </div>

              <div className="revenue-schedule">
                <span>Next distribution</span>
                <div
                  role="timer"
                  aria-label="Time until next distribution"
                  aria-live="off"
                >
                  <span className="revenue-schedule__unit">
                    <strong>{activeRoundClock?.hours ?? "--"}</strong>
                    <small>Hours</small>
                  </span>
                  <i aria-hidden="true">:</i>
                  <span className="revenue-schedule__unit">
                    <strong>{activeRoundClock?.minutes ?? "--"}</strong>
                    <small>Minutes</small>
                  </span>
                  <i aria-hidden="true">:</i>
                  <span className="revenue-schedule__unit">
                    <strong>{activeRoundClock?.seconds ?? "--"}</strong>
                    <small>Seconds</small>
                  </span>
                </div>
                {!poolState && <small>Data syncing</small>}
              </div>

              <div className="revenue-progress">
                <div
                  role="progressbar"
                  aria-label="Hourly distribution progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(
                    activeRoundClock?.progressPercent ?? 0,
                  )}
                >
                  <i
                    style={{
                      width: `${String(activeRoundClock?.progressPercent ?? 0)}%`,
                    }}
                  />
                </div>
                <span aria-live="polite">
                  <small>Hourly round</small>
                  <small>
                    {Math.round(activeRoundClock?.progressPercent ?? 0)}%
                    complete
                  </small>
                </span>
              </div>

              <div className="revenue-metrics">
                <div>
                  <strong>
                    {poolState ? <PrizePoolAmount state={poolState} /> : "—"}
                  </strong>
                  <span>Pool size</span>
                </div>
                <div>
                  <strong>
                    {poolState
                      ? formatUsdCents(poolState.totalDistributedCents)
                      : "—"}
                  </strong>
                  <span>Paid out</span>
                </div>
                <div>
                  <strong>
                    {poolState
                      ? formatParticipantCount(poolState.currentParticipants)
                      : "—"}
                  </strong>
                  <span>Eligible wallets</span>
                </div>
              </div>

              <button
                type="button"
                className="revenue-claim-button"
                onClick={() => {
                  void navigate("/claim-rewards");
                }}
              >
                <strong>Claim Your Earnings</strong>
                <span>
                  {poolState?.activeRound.status === "OPEN" && activeRoundClock
                    ? `Round ends in ${activeRoundClock.hours}:${activeRoundClock.minutes}:${activeRoundClock.seconds}`
                    : poolState?.claimStatus === "CLAIM_UNAVAILABLE_BETA"
                      ? "Review reward status and claim availability"
                      : "Open Claim Rewards"}
                </span>
              </button>

              <p id="revenue-disclosure" className="revenue-disclosure">
                {poolState?.distributionExplanation ??
                  "No simulated balances or rewards. Financial data is loading from the Walletor ledger."}{" "}
                {poolState?.valuationExplanation ?? null}{" "}
                {poolState?.accountingStatus === "DISABLED"
                  ? "Fee accounting and claims remain disabled until an approved treasury design is deployed."
                  : null}
              </p>
            </section>

            <HowItWorksButton className="how-it-works-trigger--pool how-it-works-trigger--panel" />
          </div>
        )}

        <div className="swap-flow">
          <section
            className="swap-card"
            aria-labelledby="swap-heading"
            data-quote-ready={quoteReady ? "true" : undefined}
          >
            <div className="swap-mode-bar">
              <div
                className="swap-mode-tabs"
                role="tablist"
                aria-label="Order type"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={!historyView}
                  className={historyView ? "" : "active"}
                  onClick={() => {
                    setSearchParams({});
                  }}
                >
                  Market
                </button>
              </div>
              <div className="swap-mode-actions">
                {!embeddedConcept && (
                  <div
                    className="network-row network-row--compact"
                    aria-label="Selected network"
                  >
                    <span>
                      <i className="solana-dot" /> Solana
                    </span>
                  </div>
                )}
                <span className="swap-ultra-badge">
                  <Sparkles size={14} /> Ultra
                </span>
                <button
                  type="button"
                  className={`history-button ${historyView ? "active" : ""}`}
                  aria-label="Swap history"
                  onClick={() => {
                    setSearchParams({ view: "history" });
                  }}
                >
                  <Clock3 size={17} />
                </button>
                {!historyView && (
                  <button
                    className={`settings-button ${settingsOpen ? "active" : ""}`}
                    aria-label="Swap settings"
                    aria-expanded={settingsOpen}
                    onClick={() => {
                      setSettingsOpen((value) => !value);
                    }}
                  >
                    <Settings2 size={19} />
                  </button>
                )}
              </div>
            </div>
            <h1 id="swap-heading" className="sr-only">
              Swap tokens with Jupiter
            </h1>
            <QuestlineNotice />

            {historyView ? (
              <div className="swap-history-panel">
                <header>
                  <h2>Confirmed swaps</h2>
                  <small>Stored privately on this device</small>
                </header>
                {history.length ? (
                  history.map((item) => (
                    <a
                      key={item.signature}
                      href={`https://solscan.io/tx/${encodeURIComponent(item.signature)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span>
                        <strong>
                          {item.inputAmount} {item.inputToken.symbol} →{" "}
                          {item.outputAmount} {item.outputToken.symbol}
                        </strong>
                        <small>
                          {new Date(item.confirmedAt).toLocaleString()} ·{" "}
                          {formatUsd(item.inputUsdValue)}
                        </small>
                      </span>
                      <ExternalLink size={16} />
                    </a>
                  ))
                ) : (
                  <div className="history-empty">
                    <Clock3 />
                    <strong>No confirmed swaps yet</strong>
                    <p>
                      Completed Walletor swaps will be counted and listed here.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <>
                {settingsOpen && (
                  <div className="swap-settings-panel">
                    <strong>Automatic execution protection</strong>
                    <p>
                      Jupiter RTSE optimizes slippage and priority fees for
                      current network conditions. Walletor shows the final
                      minimum received before you sign.
                    </p>
                  </div>
                )}
                {(market === "rwa" || launchBlocked) &&
                  tradingDisabledMessage && (
                    <div className="rwa-trading-disabled-notice" role="status">
                      <ShieldAlert aria-hidden="true" />
                      <span>{tradingDisabledMessage}</span>
                      {launchBlocked && <Link to="/trenches">Trenches</Link>}
                    </div>
                  )}
                <div className="amount-panel amount-panel--pay">
                  <div className="amount-panel__label">
                    <span>Sell</span>
                    <div className="amount-panel__tools">
                      <span>
                        Balance:{" "}
                        {balanceLoading
                          ? "Loading…"
                          : inputBalance
                            ? `${fromAtomicAmount(inputBalance, inputToken.decimals)} ${inputToken.symbol}`
                            : "—"}
                      </span>
                      <button
                        type="button"
                        aria-label={`Use 25% of available ${inputToken.symbol} balance`}
                        disabled={!connected || balanceLoading}
                        onClick={() => {
                          void setFraction(1n, 4n);
                        }}
                      >
                        25%
                      </button>
                      <button
                        type="button"
                        aria-label={`Use 50% of available ${inputToken.symbol} balance`}
                        disabled={!connected || balanceLoading}
                        onClick={() => {
                          void setFraction(1n, 2n);
                        }}
                      >
                        50%
                      </button>
                      <button
                        type="button"
                        aria-label={`Use 100% of available ${inputToken.symbol} balance`}
                        disabled={!connected || balanceLoading}
                        onClick={() => {
                          void setFraction(1n, 1n);
                        }}
                      >
                        100%
                      </button>
                    </div>
                  </div>
                  <div className="amount-panel__input amount-panel__input--jupiter">
                    <TokenPicker
                      token={inputToken}
                      market={market}
                      curatedTokens={curatedTokens}
                      onVerifiedRwaSelect={openVerifiedRwaTrade}
                      onChange={(selected, context) => {
                        dismissCompletedSwapFeedback();
                        if (market === "rwa") {
                          setInputToken(selected);
                          if (
                            selected.assetCategory === undefined &&
                            outputToken.assetCategory === undefined &&
                            curatedTokens[0]
                          ) {
                            setOutputToken(curatedTokens[0]);
                          }
                          setAmount("");
                          setQuote(null);
                          return;
                        }
                        if (selected.mint === outputToken.mint) {
                          setInputToken(selected);
                          setOutputToken(inputToken);
                        } else if (
                          context.preferSolPair &&
                          selected.mint !== SOL_TOKEN.mint
                        ) {
                          setInputToken(SOL_TOKEN);
                          setOutputToken(selected);
                        } else {
                          setInputToken(selected);
                        }
                        setAmount("");
                        setQuote(null);
                      }}
                    />
                    <div className="amount-panel__value">
                      <input
                        id="swap-amount"
                        aria-label="Amount to pay"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={amount}
                        onChange={(event) => {
                          dismissCompletedSwapFeedback();
                          setAmount(event.target.value);
                          setError(null);
                        }}
                      />
                      <small>
                        {activeQuote
                          ? formatUsd(activeQuote.order.inUsdValue)
                          : "$0"}
                      </small>
                    </div>
                  </div>
                </div>
                <button
                  className="reverse-button"
                  onClick={reversePair}
                  aria-label="Reverse token pair"
                >
                  <ArrowDownUp size={18} />
                </button>
                <div className="amount-panel amount-panel--receive">
                  <div className="amount-panel__label">
                    <span>Buy</span>
                    <span>
                      {outputToken.productLabel ??
                        (outputToken.isVerified
                          ? "Verified token"
                          : "Unverified token")}
                    </span>
                  </div>
                  <div className="amount-panel__input amount-panel__input--jupiter">
                    <TokenPicker
                      token={outputToken}
                      market={market}
                      curatedTokens={curatedTokens}
                      onVerifiedRwaSelect={openVerifiedRwaTrade}
                      respondToHeaderSearch
                      openRequest={tokenSearchRequested}
                      onOpenRequestHandled={handleTokenSearchRequest}
                      onChange={(selected, context) => {
                        dismissCompletedSwapFeedback();
                        if (market === "rwa") {
                          setOutputToken(selected);
                          if (
                            selected.assetCategory === undefined &&
                            inputToken.assetCategory === undefined &&
                            curatedTokens[0]
                          ) {
                            setInputToken(curatedTokens[0]);
                          }
                          setAmount("");
                          setQuote(null);
                          return;
                        }
                        if (selected.mint === inputToken.mint) {
                          setInputToken(outputToken);
                          setOutputToken(selected);
                          setAmount("");
                        } else if (
                          context.preferSolPair &&
                          selected.mint !== SOL_TOKEN.mint
                        ) {
                          setInputToken(SOL_TOKEN);
                          setAmount("");
                          setOutputToken(selected);
                        } else {
                          setOutputToken(selected);
                        }
                        setQuote(null);
                      }}
                    />
                    <div className="amount-panel__value">
                      <output aria-label="Estimated amount received">
                        {quoteLoading && hasPositiveAmount ? (
                          <LoaderCircle className="spin" size={24} />
                        ) : (
                          (quotedOutput ?? "0.00")
                        )}
                      </output>
                      <small>
                        {activeQuote
                          ? formatUsd(activeQuote.order.outUsdValue)
                          : "$0"}
                      </small>
                    </div>
                  </div>
                </div>

                {outputRiskWarnings.length > 0 && (
                  <TokenWarningsDisclosure
                    key={outputToken.mint}
                    token={outputToken}
                    warnings={outputRiskWarnings}
                  />
                )}

                {(insufficientBalance || lowSolForFees) && (
                  <div className="balance-warning">
                    {insufficientBalance
                      ? `Insufficient ${inputToken.symbol} balance.`
                      : "Your SOL balance is low"}
                  </div>
                )}

                {market === "crypto" &&
                  hasValidQuote &&
                  belowMinimumReward === true && (
                    <div
                      className="reward-minimum-notice reward-minimum-notice--warning"
                      role="alert"
                    >
                      <CircleAlert aria-hidden="true" />
                      <span>
                        This quote is below ${minimumRewardUsd}. It can still
                        execute, but it will not count toward this Prize Pool or
                        earn WLT points.
                      </span>
                    </div>
                  )}

                <div className="quote-status">
                  <span>
                    {error ??
                      (activeQuote
                        ? connected && activeQuote.order.transaction === null
                          ? orderBuildMessage(
                              activeQuote.order,
                              inputToken.symbol,
                            )
                          : `${routeSummary(activeQuote.order, jupiterzRouteBadgeEnabled)} · ${formatPercent(activeQuote.order.priceImpactPct)}% impact${activeQuote.order.gasless ? " · gasless" : ""}`
                        : hasPositiveAmount
                          ? "Finding the best Jupiter route…"
                          : amount.trim()
                            ? "Enter a valid amount to get a quote"
                            : "Enter an amount to get a quote")}
                  </span>
                  {activeQuote && (
                    <button
                      className={quoteExpired ? "expired" : ""}
                      onClick={() => {
                        if (quoteLoading) return;
                        setQuoteLoading(true);
                        setRefreshNonce((value) => value + 1);
                      }}
                    >
                      {quoteLoading
                        ? "Refreshing quote…"
                        : quoteExpired &&
                            automaticQuoteRefreshCount >=
                              MAX_AUTOMATIC_QUOTE_REFRESHES
                          ? "Refresh quote"
                          : quoteExpired
                            ? "Refreshing automatically…"
                            : `Updated ${String(Math.floor(quoteAge / 1_000))}s ago · Auto ${String(automaticQuoteRefreshCount)}/${String(MAX_AUTOMATIC_QUOTE_REFRESHES)}`}
                    </button>
                  )}
                </div>

                {highPriceImpact && (
                  <div className="price-impact-warning" role="alert">
                    Price impact is{" "}
                    {formatPercent(activeQuote?.order.priceImpactPct ?? null)}%.
                    Review the minimum received before signing.
                  </div>
                )}

                {activeQuote && (
                  <details className="quote-disclosure">
                    <summary>
                      <span>Fees &amp; details</span>
                      <ChevronDown aria-hidden="true" />
                    </summary>
                    <div className="quote-details">
                      <span>
                        <small>Minimum received</small>
                        <strong>
                          {activeQuote.order.otherAmountThreshold
                            ? `${fromAtomicAmount(
                                activeQuote.order.otherAmountThreshold,
                                outputToken.decimals,
                              )} ${outputToken.symbol}`
                            : "Protected by RTSE"}
                        </strong>
                      </span>
                      <span>
                        <small>Value</small>
                        <strong>
                          {formatUsd(activeQuote.order.outUsdValue)}
                        </strong>
                      </span>
                      <span>
                        <small>Fee breakdown</small>
                        <strong>{platformFeeLabel(activeQuote.order)}</strong>
                      </span>
                      {quoteFees && (
                        <>
                          <span>
                            <small>Walletor fee</small>
                            <strong>{quoteFees.walletor}</strong>
                          </span>
                          <span>
                            <small>Jupiter share</small>
                            <strong>{quoteFees.jupiter}</strong>
                          </span>
                        </>
                      )}
                      {quoteAdditionalFee && (
                        <span>
                          <small>Additional execution fees</small>
                          <strong>{quoteAdditionalFee}</strong>
                        </span>
                      )}
                      <span>
                        <small>Network costs</small>
                        <strong>{formatNetworkCost(activeQuote.order)}</strong>
                      </span>
                      <span>
                        <small>Execution type</small>
                        <strong>
                          {routeSummary(
                            activeQuote.order,
                            jupiterzRouteBadgeEnabled,
                          )}
                        </strong>
                      </span>
                    </div>
                  </details>
                )}

                {!connected ? (
                  <SwapConnectButton />
                ) : (
                  <button
                    className={`swap-primary-button swap-primary-button--connected${
                      quoteReady ? " swap-primary-button--ready" : ""
                    }`}
                    disabled={!hasValidQuote || tradeUnavailable || submitting}
                    onClick={() => {
                      void submitSwap();
                    }}
                  >
                    {submitting ? (
                      <>
                        <LoaderCircle className="spin" size={20} />
                        {submissionPhase === "swapping"
                          ? "Swapping"
                          : "Opening wallet"}
                      </>
                    ) : (
                      primaryActionLabel
                    )}
                  </button>
                )}

                {signature && swapConfirmationVisible && (
                  <div className="swap-success">
                    <div
                      className="swap-success__headline"
                      role="status"
                      aria-live="polite"
                    >
                      <CheckCircle2 aria-hidden="true" size={17} />
                      <span>
                        {market === "rwa"
                          ? "RWA trade confirmed"
                          : rewardReceipt
                            ? rewardReceiptLabel(
                                rewardReceipt,
                                minimumRewardUsd,
                              )
                            : accountingStatus === "NOT_ELIGIBLE"
                              ? `Swap confirmed · below $${minimumRewardUsd} minimum · no Prize Pool entry or WLT`
                              : "Swap confirmed"}
                      </span>
                      <span aria-hidden="true">·</span>
                      <a
                        href={`https://solscan.io/tx/${encodeURIComponent(signature)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View on Solscan
                        <ExternalLink aria-hidden="true" />
                      </a>
                    </div>
                    {market === "crypto" &&
                      !rewardReceipt &&
                      accountingStatus !== "NOT_ELIGIBLE" && (
                        <div
                          className="swap-success__sync"
                          aria-label="Rewards are syncing. Verified rewards will appear automatically."
                        >
                          <strong aria-hidden="true">
                            {rewardSyncSeconds === null ||
                            rewardSyncSeconds === 0
                              ? "Rewards syncing · final verification"
                              : `Rewards syncing (${String(rewardSyncSeconds)} ${
                                  rewardSyncSeconds === 1 ? "second" : "seconds"
                                })`}
                          </strong>
                          <small>
                            Your Prize Pool entry and WLT points will appear
                            automatically after verification.
                          </small>
                        </div>
                      )}
                  </div>
                )}
              </>
            )}
          </section>
          {!historyView && (
            <div className="swap-support-row">
              <div className="jupiter-credit">
                <img src="/assets/jupiter-logo.svg" alt="" /> Powered by Jupiter
                · Best execution on Solana
              </div>
              <HowItWorksButton className="how-it-works-trigger--panel" />
            </div>
          )}
        </div>

        {celebrationReceipt && signature && swapConfirmationVisible && (
          <RewardCelebrationModal
            receipt={celebrationReceipt}
            signature={signature}
            onClose={closeRewardCelebration}
          />
        )}
      </div>
      {!embeddedConcept && <WalletorEnginePage embedded />}
    </>
  );
}
