import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";

import { AppShell } from "./AppShell";
import { SolanaProvider } from "../features/swap/SolanaProvider";
import { SupportChat } from "../features/support/SupportChat";
import { ReferralInviteNotice } from "../features/referrals/ReferralPanel";
import { DirectInfluencerTracking } from "../features/affiliates/DirectInfluencerTracking";
import {
  SegmentoTracking,
  ReferralPrivacyPage,
} from "../features/affiliates/SegmentoTracking";
const ReferralPage = lazy(async () => ({
  default: (await import("../features/referrals/ReferralPage")).ReferralPage,
}));
const InfluencerPage = lazy(async () => ({
  default: (await import("../features/affiliates/InfluencerPage"))
    .InfluencerPage,
}));
const LeaderboardPage = lazy(async () => ({
  default: (await import("../features/leaderboard/LeaderboardPage"))
    .LeaderboardPage,
}));

const SwapPage = lazy(async () => {
  const module = await import("../features/swap/SwapPage");
  return { default: module.SwapPage };
});
const LaunchBoardPage = lazy(async () => ({
  default: (await import("../features/launches/LaunchBoardPage"))
    .LaunchBoardPage,
}));
const PrizePoolPage = lazy(async () => {
  const module = await import("../features/prize-pool/PrizePoolPage");
  return { default: module.PrizePoolPage };
});
const WalletorDesignPreview = lazy(async () => {
  const module =
    await import("../features/design-preview/WalletorDesignPreview");
  return { default: module.WalletorDesignPreview };
});
const WalletorConceptTwo = lazy(async () => {
  const module =
    await import("../features/design-preview-v2/WalletorConceptTwo");
  return { default: module.WalletorConceptTwo };
});
const WalletorConceptClaimPage = lazy(async () => {
  const module =
    await import("../features/design-preview-v2/WalletorConceptClaimPage");
  return { default: module.WalletorConceptClaimPage };
});
const WalletorConceptPrizePoolPage = lazy(async () => {
  const module =
    await import("../features/design-preview-v2/WalletorConceptPrizePoolPage");
  return { default: module.WalletorConceptPrizePoolPage };
});
const WalletorConceptRewardsPage = lazy(async () => {
  const module =
    await import("../features/design-preview-v2/WalletorConceptRewardsPage");
  return { default: module.WalletorConceptRewardsPage };
});
const WalletorAirdropPage = lazy(async () => {
  const module =
    await import("../features/design-preview-v2/WalletorAirdropPage");
  return { default: module.WalletorAirdropPage };
});
const WalletorConceptHistoryPage = lazy(async () => {
  const module =
    await import("../features/design-preview-v2/WalletorConceptHistoryPage");
  return { default: module.WalletorConceptHistoryPage };
});
const WalletorStocksRwaPage = lazy(async () => {
  const module =
    await import("../features/design-preview-v2/WalletorStocksRwaPage");
  return { default: module.WalletorStocksRwaPage };
});
const WalletorConceptTokenDetailPage = lazy(async () => {
  const module =
    await import("../features/design-preview-v2/WalletorConceptTokenDetailPage");
  return { default: module.WalletorConceptTokenDetailPage };
});
const WalletorConceptNotFoundPage = lazy(async () => {
  const module =
    await import("../features/design-preview-v2/WalletorConceptNotFoundPage");
  return { default: module.WalletorConceptNotFoundPage };
});
const AdminDashboardPage = lazy(async () => {
  const module = await import("../features/admin/AdminDashboardPage");
  return { default: module.AdminDashboardPage };
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      retry: (failureCount, error) =>
        error instanceof Error &&
        "retryable" in error &&
        error.retryable === true &&
        failureCount < 1,
      refetchOnWindowFocus: false,
    },
  },
});

export function App() {
  return (
    <SolanaProvider>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <SegmentoTracking />
          <DirectInfluencerTracking />
          <ReferralInviteNotice />
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route
                path="referral-privacy"
                element={<ReferralPrivacyPage />}
              />
              <Route path="leaderboard" element={<LeaderboardPage />} />
              <Route path="influencers" element={<InfluencerPage />} />
              <Route path="referal" element={<ReferralPage />} />
              <Route
                path="referral"
                element={<Navigate to="/referal" replace />}
              />
              <Route path="admin" element={<AdminDashboardPage />} />
              <Route
                path="design-preview"
                element={<WalletorDesignPreview />}
              />
              <Route index element={<WalletorConceptTwo />} />
              <Route path="trenches" element={<LaunchBoardPage />} />
              <Route path="new-tokens" element={<LegacyLaunchRedirect />} />
              <Route
                path="claim-rewards"
                element={<WalletorConceptClaimPage />}
              />
              <Route
                path="prize-pool"
                element={<WalletorConceptPrizePoolPage />}
              />
              <Route path="airdrop" element={<WalletorAirdropPage />} />
              <Route path="rewards" element={<WalletorConceptRewardsPage />} />
              <Route path="history" element={<WalletorConceptHistoryPage />} />
              <Route path="stocks-rwa" element={<WalletorStocksRwaPage />} />
              <Route
                path="stocks"
                element={<Navigate to="/stocks-rwa" replace />}
              />
              <Route
                path="tokens/:address"
                element={<WalletorConceptTokenDetailPage />}
              />
              <Route
                path="claim"
                element={<Navigate to="/claim-rewards" replace />}
              />
              <Route
                path="design-preview-2"
                element={<Navigate to="/" replace />}
              />
              <Route
                path="design-preview-2/claim-rewards"
                element={<Navigate to="/claim-rewards" replace />}
              />
              <Route
                path="design-preview-2/prize-pool"
                element={<Navigate to="/prize-pool" replace />}
              />
              <Route
                path="design-preview-2/airdrop"
                element={<Navigate to="/airdrop" replace />}
              />
              <Route
                path="design-preview-2/rewards"
                element={<Navigate to="/rewards" replace />}
              />
              <Route
                path="design-preview-2/history"
                element={<Navigate to="/history" replace />}
              />
              <Route
                path="design-preview-2/tokens/:address"
                element={<LegacyTokenRedirect />}
              />
              <Route
                path="design-preview-2/*"
                element={<Navigate to="/" replace />}
              />
              <Route element={<AppShell />}>
                <Route path="swap" element={<SwapPage />} />
                <Route path="revenue-pool" element={<PrizePoolPage />} />
              </Route>
              <Route path="*" element={<WalletorConceptNotFoundPage />} />
            </Routes>
          </Suspense>
          <SupportChat />
        </BrowserRouter>
      </QueryClientProvider>
    </SolanaProvider>
  );
}

function LegacyLaunchRedirect() {
  const location = useLocation();
  return (
    <Navigate to={`/trenches${location.search}${location.hash}`} replace />
  );
}

function LegacyTokenRedirect() {
  const location = useLocation();
  const address = location.pathname.split("/").at(-1);
  return <Navigate to={address ? `/tokens/${address}` : "/"} replace />;
}

function RouteLoading() {
  return <main className="route-loading" aria-label="Loading Walletor" />;
}
