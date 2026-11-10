import { SwapPage } from "../swap/SwapPage";

export function TradingDeck() {
  return (
    <section
      id="concept-swap"
      className="concept-trade concept-trade--live"
      aria-label="Walletor swap"
    >
      <header className="concept-live-swap-heading">
        <div>
          <h2>Swap</h2>
        </div>
        <span>Powered by the Walletor execution engine</span>
      </header>
      <SwapPage embeddedConcept />
    </section>
  );
}
