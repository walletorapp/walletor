const storageKey = "walletor:questline:89:v1";
let optedOut = false;

export function questlineCampaign(): 89 | undefined {
  if (optedOut) return undefined;
  if (new URLSearchParams(window.location.search).get("quest") === "89")
    return 89;
  try {
    return sessionStorage.getItem(storageKey) ===
      new Date().toISOString().slice(0, 10)
      ? 89
      : undefined;
  } catch {
    return undefined;
  }
}

export function rememberQuestlineCampaign() {
  const quest = questlineCampaign();
  if (quest) {
    try {
      sessionStorage.setItem(storageKey, new Date().toISOString().slice(0, 10));
    } catch {
      /* The explicit quest URL still works when browser storage is blocked. */
    }
  }
  return quest;
}

export function leaveQuestlineCampaign() {
  optedOut = true;
  try {
    sessionStorage.removeItem(storageKey);
  } catch {
    /* The URL is removed separately, so a blocked store cannot opt users in. */
  }
}
