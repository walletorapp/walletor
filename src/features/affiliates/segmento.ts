import {
  SegmentoClient,
  decodeToken,
  redeemReferral,
  clearSessionCookie,
} from "@segmento/core";
import bs58 from "bs58";
import { SEGMENTO_PROJECT_TOKEN } from "./segmento-project";

const API = "https://referral.segmento.tech/manager-api";

export interface SegmentoPreparationOptions {
  /** Analytics only; this never enables commission accounting. */
  enabled?: boolean;
  projectToken?: string;
  /** Validated campaign link code; analytics attribution is not payment proof. */
  referralCode: string;
  campaign?: string;
  isAllowed?: () => boolean;
  fetchImpl?: typeof fetch;
}

function isBase58Bytes(value: string, length: number): boolean {
  try {
    return bs58.decode(value).length === length;
  } catch {
    return false;
  }
}

/**
 * Analytics are best effort; they must never authorize commission payments.
 * Pin attribution and strip page URLs so the SDK cannot forward unrelated
 * query parameters or replace attribution using its shared `ref` cookie.
 */
export function prepareSegmentoSession(options: SegmentoPreparationOptions) {
  if (!options.enabled || (options.isAllowed && !options.isAllowed()))
    return null;
  const projectToken = options.projectToken ?? SEGMENTO_PROJECT_TOKEN;
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(options.referralCode)) {
    console.warn("Segmento disabled: invalid campaign referral code.");
    return null;
  }
  const referralCode = options.referralCode;
  let projectId: string;
  try {
    projectId = decodeToken(projectToken).pid;
  } catch {
    console.warn("Segmento disabled: invalid public project token.");
    return null;
  }

  const landing = new URL("https://walletor.com/");
  landing.searchParams.set("ref", referralCode);
  if (options.campaign && /^[a-zA-Z0-9_-]{1,128}$/.test(options.campaign))
    landing.searchParams.set("utm_campaign", options.campaign);
  const completed = new Set<string>();
  const inFlight = new Set<string>();
  const fetchImpl = options.fetchImpl ?? fetch;

  // The SDK does not check HTTP status for wallet events and leaves its
  // automatic impression promise unhandled. Observe failures here and always
  // resolve its transport, independently of swap execution.
  const transport: typeof fetch = async (input, init) => {
    if (options.isAllowed && !options.isAllowed()) return new Response(null);
    let key: string | null = null;
    let ownsRequest = false;
    try {
      if (typeof input !== "string") throw new Error("Unsupported SDK URL");
      const endpoint = input;
      if (init?.method !== "POST") throw new Error("Unsupported SDK method");
      let payload: Record<string, unknown>;
      if (endpoint === `${API}/redeem`) {
        key = "impression";
        payload = { url: landing.href };
      } else {
        if (
          endpoint !== `${API}/wallet-connect` &&
          endpoint !== `${API}/wallet-transaction`
        )
          throw new Error("Unsupported SDK endpoint");
        if (typeof init.body !== "string")
          throw new Error("Unsupported SDK body");
        const raw: unknown = JSON.parse(init.body);
        if (!raw || typeof raw !== "object" || !("wallet_address" in raw))
          throw new Error("Missing wallet");
        const wallet = raw.wallet_address;
        if (typeof wallet !== "string" || !isBase58Bytes(wallet, 32))
          throw new Error("Invalid wallet");
        payload = {
          project_id: projectId,
          origin_url: landing.href,
          referral_code: referralCode,
          wallet_address: wallet,
          wallet_chain: "solana",
        };
        key = `connect:${wallet}`;
        if (endpoint === `${API}/wallet-transaction`) {
          if (!("meta" in raw) || !raw.meta || typeof raw.meta !== "object")
            throw new Error("Missing signature");
          const tx = "tx" in raw.meta ? raw.meta.tx : null;
          if (typeof tx !== "string" || !isBase58Bytes(tx, 64))
            throw new Error("Invalid signature");
          payload.meta = { tx };
          key = `swap:${wallet}:${tx}`;
        }
      }
      if (completed.has(key) || inFlight.has(key)) return new Response(null);
      inFlight.add(key);
      ownsRequest = true;
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error("Tracking request failed");
      completed.add(key);
    } catch {
      // Do not log wallet addresses, tokens, URLs, signatures or response bodies.
      console.warn(
        "Segmento tracking unavailable; swap processing is unaffected.",
      );
    } finally {
      if (key && ownsRequest) inFlight.delete(key);
    }
    return new Response(null);
  };

  let client: SegmentoClient;
  try {
    client = SegmentoClient.init(projectToken, {
      fetchImpl: transport,
    });
  } catch {
    console.warn(
      "Segmento initialization unavailable; tracking remains disabled.",
    );
    return null;
  }
  function dispatch(event: () => void) {
    try {
      event();
    } catch {
      console.warn(
        "Segmento tracking unavailable; swap processing is unaffected.",
      );
    }
  }
  return {
    visit() {
      // Retry a failed impression even if the SDK's session cookie was set
      // before its first network request. Successful sends are deduplicated.
      void redeemReferral(landing.href, { fetchImpl: transport }).catch(() => {
        console.warn("Segmento visit tracking unavailable.");
      });
    },
    clear() {
      dispatch(() => {
        clearSessionCookie("sgm_ref");
        clearSessionCookie("sgm_impression_sent");
      });
    },
    walletConnected(walletAddress: string) {
      dispatch(() => {
        client.trackWalletConnect({ walletAddress, chain: "solana" });
      });
    },
    /** Call only after the Worker reports Jupiter Success with this signature. */
    swapConfirmed(walletAddress: string, signature: string) {
      dispatch(() => {
        client.trackWalletTransaction({
          walletAddress,
          chain: "solana",
          tx: signature,
        });
      });
    },
  };
}
