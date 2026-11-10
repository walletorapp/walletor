import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  questlineCampaign,
  leaveQuestlineCampaign,
  rememberQuestlineCampaign,
} from "./questline-campaign";

export function QuestlineNotice() {
  const [active, setActive] = useState(() => Boolean(questlineCampaign()));
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (active) rememberQuestlineCampaign();
  }, [active]);
  if (!active) return null;
  return (
    <aside className="questline-notice" aria-label="MagicBlock daily quest">
      <strong>MagicBlock daily quest</strong>
      <p>
        Start Quest 89 on MagicBlock first, then complete one eligible $5+ swap
        each day (UTC). Your wallet address and verified completion will be
        shared with Questline.
      </p>
      <a
        href="https://quests.magicblock.app/projects/walletor"
        target="_blank"
        rel="noopener noreferrer"
      >
        Open Questline
      </a>
      <button
        type="button"
        onClick={() => {
          leaveQuestlineCampaign();
          const params = new URLSearchParams(location.search);
          params.delete("quest");
          setActive(false);
          void navigate(
            {
              pathname: location.pathname,
              search: params.toString(),
              hash: location.hash,
            },
            { replace: true },
          );
        }}
      >
        Leave quest
      </button>
    </aside>
  );
}
