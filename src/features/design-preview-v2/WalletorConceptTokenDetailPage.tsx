import { TokenTradingPage } from "../tokens/TokenTradingPage";
import { ConceptPageShell } from "./ConceptPageShell";

export function WalletorConceptTokenDetailPage() {
  return (
    <ConceptPageShell className="concept-token-detail-page">
      <TokenTradingPage />
    </ConceptPageShell>
  );
}
