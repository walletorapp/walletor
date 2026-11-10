import { ArrowUpRight, MessageCircle, Share2, Users } from "lucide-react";
import { useId } from "react";
import { Link } from "react-router-dom";
import "./social-rewards.css";

const communityTasks = [
  {
    title: "Follow Walletor on X",
    description: "News, daily rounds and product updates from @walletorai.",
    href: "https://x.com/walletorai",
    logo: "/assets/x-logo.svg",
    action: "Open X",
  },
  {
    title: "Join Walletor on Telegram",
    description: "Meet the community and stay up to date.",
    href: "https://t.me/walletorswap",
    logo: "/assets/telegram-logo.svg",
    action: "Open Telegram",
  },
];

export function SocialRewardsPanel() {
  const titleId = useId();
  return (
    <section className="social-rewards" aria-labelledby={titleId}>
      <header className="social-rewards__header">
        <span className="social-rewards__eyebrow">COMMUNITY & REFERRALS</span>
        <h2 id={titleId}>Earn more WLT</h2>
        <p>
          Invite friends to earn verified WLT Points. Explore the community
          while social rewards get ready.
        </p>
      </header>
      <div className="social-rewards__tasks">
        <Link
          className="social-rewards__task social-rewards__task--live"
          to="/referal"
        >
          <span className="social-rewards__icon">
            <Users aria-hidden="true" size={26} />
          </span>
          <span className="social-rewards__copy">
            <strong>Invite a friend</strong>
            <span>
              Earn once when a new wallet registers your link and completes its
              first eligible swap of at least $5.
            </span>
          </span>
          <span className="social-rewards__action">
            <span className="social-rewards__bonus">+100 WLT Points</span>
            <span>
              Get your referral link{" "}
              <ArrowUpRight aria-hidden="true" size={16} />
            </span>
          </span>
        </Link>
        {communityTasks.map((task) => (
          <a
            className="social-rewards__task"
            key={task.href}
            href={task.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span className="social-rewards__icon">
              <img src={task.logo} alt="" width="26" height="26" />
            </span>
            <span className="social-rewards__copy">
              <strong>{task.title}</strong>
              <span>{task.description}</span>
            </span>
            <span className="social-rewards__action">
              <span className="social-rewards__pending">
                Rewards coming soon
              </span>
              <span>
                {task.action} <ArrowUpRight aria-hidden="true" size={16} />
              </span>
            </span>
          </a>
        ))}
        <Link className="social-rewards__task" to="/referal">
          <span className="social-rewards__icon">
            <Share2 aria-hidden="true" size={26} />
          </span>
          <span className="social-rewards__copy">
            <strong>Share your referral link</strong>
            <span>
              Share on X, WhatsApp or Telegram. Points come from qualified
              referrals, not the share itself.
            </span>
          </span>
          <span className="social-rewards__action">
            <span className="social-rewards__pending">Referral rewards</span>
            <span>
              Share Walletor <ArrowUpRight aria-hidden="true" size={16} />
            </span>
          </span>
        </Link>
        <a
          className="social-rewards__task"
          href="https://discord.gg/hUCrahcEZK"
          target="_blank"
          rel="noopener noreferrer"
        >
          <span className="social-rewards__icon">
            <MessageCircle aria-hidden="true" size={26} />
          </span>
          <span className="social-rewards__copy">
            <strong>Join Walletor on Discord</strong>
            <span>Join the community for updates and discussion.</span>
          </span>
          <span className="social-rewards__action">
            <span className="social-rewards__pending">Rewards coming soon</span>
            <span>
              Open Discord <ArrowUpRight aria-hidden="true" size={16} />
            </span>
          </span>
        </a>
      </div>
      <p className="social-rewards__note">
        Social-task rewards are not active yet. Following, joining or opening a
        link does not currently earn points. WLT Points are not transferable
        tokens.
      </p>
    </section>
  );
}
