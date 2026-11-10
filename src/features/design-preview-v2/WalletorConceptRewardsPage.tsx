import { ConceptPageShell } from "./ConceptPageShell";
import { WalletorEnginePanel } from "./WalletorEnginePanel";
import { SocialRewardsPanel } from "../referrals/SocialRewardsPanel";

export function WalletorConceptRewardsPage() {
  return (
    <ConceptPageShell className="concept-rewards-page">
      <WalletorEnginePanel variant="page" />
      <SocialRewardsPanel />
    </ConceptPageShell>
  );
}
