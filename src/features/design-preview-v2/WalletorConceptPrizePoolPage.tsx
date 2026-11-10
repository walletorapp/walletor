import { Landmark } from "lucide-react";

import { PrizePoolPage } from "../prize-pool/PrizePoolPage";
import { ConceptPageHeading } from "./ConceptPageHeading";
import { ConceptPageShell } from "./ConceptPageShell";

export function WalletorConceptPrizePoolPage() {
  return (
    <ConceptPageShell className="concept-pool-page">
      <ConceptPageHeading
        eyebrow="Public accounting"
        title="Prize Pool"
        description="Follow automatic formula-based allocations, recipient wallets and on-chain payout evidence. No team member hand-picks winners."
        icon={Landmark}
      />
      <PrizePoolPage />
    </ConceptPageShell>
  );
}
