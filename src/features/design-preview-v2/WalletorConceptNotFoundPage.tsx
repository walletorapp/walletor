import { NotFoundPage } from "../tokens/NotFoundPage";
import { ConceptPageShell } from "./ConceptPageShell";
import { walletorRoutes } from "./routes";

export function WalletorConceptNotFoundPage() {
  return (
    <ConceptPageShell className="concept-not-found-page">
      <NotFoundPage returnTo={walletorRoutes.home} />
    </ConceptPageShell>
  );
}
