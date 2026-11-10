import { useEffect, useSyncExternalStore } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Link, useLocation } from "react-router-dom";
import { segmentoRuntime } from "./segmento-runtime";
import "./segmento.css";

export function SegmentoTracking() {
  const location = useLocation();
  const { connected, publicKey } = useWallet();
  const state = useSyncExternalStore(
    segmentoRuntime.subscribe,
    segmentoRuntime.getSnapshot,
  );
  const wallet = connected ? (publicKey?.toBase58() ?? null) : null;
  useEffect(() => {
    segmentoRuntime.route(location.pathname, location.search);
  }, [location.pathname, location.search]);
  useEffect(() => {
    segmentoRuntime.connected(wallet);
  }, [wallet, state.choice, state.publicPage, state.referralCode]);
  return null;
}

export function ReferralPrivacyPage() {
  const state = useSyncExternalStore(
    segmentoRuntime.subscribe,
    segmentoRuntime.getSnapshot,
  );
  return (
    <main className="segmento-privacy">
      <Link to="/">← Back to Walletor</Link>
      <h1>Referral tracking</h1>
      <p>
        <Link to="/influencers">Influencer earnings dashboard</Link>
      </p>
      <p>
        Walletor uses Segmento to measure visits and activity from supported
        creator referral links generated through Segmento.
      </p>
      <p>
        Tracking starts automatically for supported referral links unless you
        previously stopped it in this tab. We send Segmento the referral code
        and campaign, your connected public Solana wallet address, and
        signatures of new swaps started and confirmed while tracking is enabled.
        These identifiers can link your visit to public on-chain activity.
        Segmento also receives the connection information normally sent with a
        web request, such as your IP address.
      </p>
      <p>
        Your tracking setting and referral are saved in this tab’s session
        storage. The SDK also uses session cookies for referral and visit
        tracking. You can stop future tracking below and keep using Walletor.
        Stopping does not erase data already delivered to Segmento.
      </p>
      <p>
        Tracking is best effort and is separate from WLT rewards and payments.
        Walletor’s own influencer program is separate from Segmento tracking.
        Walletor influencer links start with wlr- and are not sent to Segmento.
        Lifetime commissions require a separate signed registration before your
        first order and come from the existing reserve, with no extra referral
        charge. Stopping analytics does not erase an existing signed
        registration or financial records.
      </p>
      <p>
        For questions about data already shared or retention, contact{" "}
        <a href="mailto:support@walletor.com">support@walletor.com</a>.
      </p>
      <p>
        Walletor’s direct influencer referral code is saved in this browser for
        up to 30 days so you can register on a return visit. Creating a creator
        link publishes a link derived from your public wallet address. A signed
        user registration is stored permanently on the server for lifetime fee
        accounting. Direct program registrations and earnings are not sent to
        Segmento.
      </p>
      {state.referralCode ? (
        <>
          <p>Tracking: {state.choice === "decline" ? "Stopped" : "Enabled"}.</p>
          <button
            type="button"
            onClick={() => {
              segmentoRuntime.choose("decline");
            }}
          >
            Stop referral tracking
          </button>
          {state.choice === "decline" ? (
            <button
              type="button"
              onClick={() => {
                segmentoRuntime.choose("allow");
              }}
            >
              Enable referral tracking
            </button>
          ) : null}
        </>
      ) : (
        <p>No supported creator referral is active in this tab.</p>
      )}
    </main>
  );
}
