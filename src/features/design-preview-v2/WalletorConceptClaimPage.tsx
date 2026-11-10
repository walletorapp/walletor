import { ClaimPage } from "../prize-pool/ClaimPage";
import { RecentWinners } from "../leaderboard/LeaderboardPage";
import { ReferralPanel } from "../referrals/ReferralPanel";
import { SocialRewardsPanel } from "../referrals/SocialRewardsPanel";
import { ConceptPageShell } from "./ConceptPageShell";
import { walletorRoutes } from "./routes";

const conceptLinks = {
  swap: walletorRoutes.home,
  rewards: walletorRoutes.rewards,
  prizePool: walletorRoutes.prizePool,
};

export function WalletorConceptClaimPage() {
  return (
    <ConceptPageShell
      className="concept-claim-page"
      mainClassName="concept-claim-main"
    >
      <ClaimPage links={conceptLinks} />
      <RecentWinners />
      <SocialRewardsPanel />
      <ReferralPanel compact />
    </ConceptPageShell>
  );
}
