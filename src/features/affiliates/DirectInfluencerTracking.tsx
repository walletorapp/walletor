import { useEffect, useSyncExternalStore } from "react";
import { useLocation } from "react-router-dom";
import { isDirectInfluencerCode } from "../../../shared/influencer-contracts";
import { InfluencerInvite } from "./InfluencerInvite";
import "./segmento.css";

const storageKey = "walletor:direct-influencer:v1";
const changeEvent = "walletor-direct-influencer-change";
function savedCode(): string | null {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(storageKey) ?? "null",
    );
    if (
      typeof value !== "object" ||
      value === null ||
      !("code" in value) ||
      !("expiresAt" in value) ||
      typeof value.code !== "string" ||
      typeof value.expiresAt !== "number" ||
      value.expiresAt <= Date.now() ||
      !isDirectInfluencerCode(value.code)
    )
      return null;
    return value.code;
  } catch {
    return null;
  }
}
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(changeEvent, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(changeEvent, callback);
  };
}
export function DirectInfluencerTracking() {
  const location = useLocation();
  const saved = useSyncExternalStore(subscribe, savedCode, () => null);
  const raw = new URLSearchParams(location.search).get("ref");
  const candidate = raw && isDirectInfluencerCode(raw) ? raw : null;
  const publicPage = !location.pathname.startsWith("/admin");
  useEffect(() => {
    if (!publicPage || !candidate) return;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          code: candidate,
          expiresAt: Date.now() + 30 * 86_400_000,
        }),
      );
      window.dispatchEvent(new Event(changeEvent));
    } catch {
      /* Current URL remains usable without storage. */
    }
  }, [candidate, publicPage]);
  const code = candidate ?? saved;
  return publicPage && code ? <InfluencerInvite code={code} /> : null;
}
