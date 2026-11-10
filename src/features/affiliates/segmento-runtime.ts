import { SEGMENTO_TEST_REFERRAL } from "./segmento-project";
import { isDirectInfluencerCode } from "../../../shared/influencer-contracts";
import {
  safeSegmentoCampaign,
  segmentoReferral,
  validSegmentoCode,
} from "./segmento-referral";
import type {
  prepareSegmentoSession,
  SegmentoPreparationOptions,
} from "./segmento";

type Session = NonNullable<ReturnType<typeof prepareSegmentoSession>>;
// Automatic tracking is a default setting, not a record of affirmative consent.
type Choice = "automatic" | "allow" | "decline" | null;
interface Snapshot {
  referralCode: string | null;
  campaign: string | null;
  choice: Choice;
  publicPage: boolean;
}
const STORAGE_KEY = "walletor:segmento-pilot:v1";
const DIRECT_SESSION_KEY = "walletor:direct-influencer-session:v1";

export function createSegmentoRuntime(
  loadSession: (options: SegmentoPreparationOptions) => Promise<Session | null>,
  storage: () => Storage,
) {
  let snapshot: Snapshot = {
    referralCode: null,
    campaign: null,
    choice: null,
    publicPage: false,
  };
  let restored = false;
  let directRestored = false;
  let directSession = false;
  let session: Session | null = null;
  let loading: Promise<Session | null> | null = null;
  const listeners = new Set<() => void>();
  const allowed = () =>
    snapshot.publicPage &&
    (snapshot.choice === "automatic" || snapshot.choice === "allow") &&
    !!snapshot.referralCode;
  function publish(next: Snapshot) {
    if (JSON.stringify(snapshot) === JSON.stringify(next)) return;
    snapshot = next;
    listeners.forEach((listener) => {
      listener();
    });
  }
  function issue() {
    console.warn("Referral tracking unavailable; Walletor remains usable.");
  }
  function savePreference() {
    try {
      storage().setItem(
        STORAGE_KEY,
        JSON.stringify({
          referralCode: snapshot.referralCode,
          campaign: snapshot.campaign,
          choice: snapshot.choice,
        }),
      );
    } catch {
      issue();
    }
  }
  async function getSession() {
    if (!allowed() || !snapshot.referralCode) return null;
    if (session) return session;
    loading ??= loadSession({
      enabled: true,
      referralCode: snapshot.referralCode,
      campaign: snapshot.campaign ?? undefined,
      isAllowed: allowed,
    });
    const candidate = await loading;
    loading = null;
    if (!allowed()) {
      candidate?.clear();
      return null;
    }
    session = candidate;
    return session;
  }
  function send(event: (client: Session) => void) {
    void getSession()
      .then((client) => {
        if (client && allowed()) event(client);
      })
      .catch(() => {
        loading = null;
        issue();
      });
  }
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    route(path: string, search: string) {
      const publicRoute = !/^\/admin/i.test(path);
      const incomingSegmento = segmentoReferral(search);
      if (!directRestored) {
        directRestored = true;
        try {
          directSession = storage().getItem(DIRECT_SESSION_KEY) === "1";
        } catch {
          issue();
        }
      }
      if (publicRoute) {
        const directCode = new URLSearchParams(search).get("ref");
        const direct =
          directCode !== null && isDirectInfluencerCode(directCode);
        if (direct || incomingSegmento) {
          directSession = direct;
          try {
            storage().setItem(DIRECT_SESSION_KEY, direct ? "1" : "0");
          } catch {
            issue();
          }
          if (direct) {
            session?.clear();
            session = null;
          }
        }
      }
      const publicPage =
        publicRoute && !directSession && !/^\/influencers(?:\/|$)/i.test(path);
      let { referralCode, campaign, choice } = snapshot;
      if (publicPage && !restored) {
        restored = true;
        try {
          const raw: unknown = JSON.parse(
            storage().getItem(STORAGE_KEY) ?? "null",
          );
          if (
            raw &&
            typeof raw === "object" &&
            "referralCode" in raw &&
            validSegmentoCode(raw.referralCode) &&
            "choice" in raw &&
            (raw.choice === "automatic" ||
              raw.choice === "allow" ||
              raw.choice === "decline")
          ) {
            referralCode = raw.referralCode;
            campaign =
              safeSegmentoCampaign("campaign" in raw ? raw.campaign : null) ??
              (referralCode === SEGMENTO_TEST_REFERRAL.referralCode
                ? SEGMENTO_TEST_REFERRAL.campaign
                : null);
            choice = raw.choice;
          }
        } catch {
          issue();
        }
      }
      const incoming = publicPage ? incomingSegmento : null;
      if (!referralCode && incoming) {
        referralCode = incoming.referralCode;
        campaign = incoming.campaign;
      }
      const startAutomatically =
        publicPage && !!referralCode && choice === null;
      if (startAutomatically) choice = "automatic";
      publish({ referralCode, campaign, choice, publicPage });
      if (startAutomatically) savePreference();
      if (allowed())
        send((client) => {
          client.visit();
        });
    },
    choose(choice: "allow" | "decline") {
      if (!snapshot.referralCode || !snapshot.publicPage) return;
      publish({ ...snapshot, choice });
      savePreference();
      if (choice === "decline") {
        session?.clear();
        session = null;
      } else
        send((client) => {
          client.visit();
        });
    },
    connected(wallet: string | null) {
      if (wallet && allowed())
        send((client) => {
          client.walletConnected(wallet);
        });
    },
    swapReporter(wallet: string) {
      // Capture tracking preference/attribution when this swap starts, not from the wallet
      // connected later or an old transaction in browser history.
      const referral = allowed() ? snapshot.referralCode : null;
      return (result: { status: string; signature?: string | null }) => {
        const signature = result.signature;
        if (
          !referral ||
          referral !== snapshot.referralCode ||
          !allowed() ||
          result.status !== "Success" ||
          !signature
        )
          return;
        send((client) => {
          client.swapConfirmed(wallet, signature);
        });
      };
    },
  };
}

export const segmentoRuntime = createSegmentoRuntime(
  async (options) => {
    const { prepareSegmentoSession } = await import("./segmento");
    // Tracking preference may have changed while the SDK chunk was loading.
    return options.isAllowed?.() ? prepareSegmentoSession(options) : null;
  },
  () => window.sessionStorage,
);
