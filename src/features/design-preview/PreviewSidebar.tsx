import {
  ArrowLeftRight,
  Clock3,
  Coins,
  Gift,
  Sparkles,
  Trophy,
} from "lucide-react";

const primaryItems = [
  { label: "Swap", icon: ArrowLeftRight, active: true },
  { label: "Prize Pool", icon: Coins, active: false },
  { label: "Rewards", icon: Gift, badge: "WLT", active: false },
  { label: "Claim Rewards", icon: Trophy, active: false },
] as const;

const manageItems = [{ label: "History", icon: Clock3 }] as const;

export function PreviewSidebar() {
  return (
    <aside className="relative z-20 flex w-full shrink-0 flex-col border-b border-white/10 bg-[#060a12]/95 px-4 py-4 backdrop-blur-xl lg:fixed lg:inset-y-0 lg:left-0 lg:w-[236px] lg:border-r lg:border-b-0 lg:px-4 lg:py-6">
      <div className="flex items-center gap-3 px-3 lg:mb-9">
        <div className="relative grid size-11 place-items-center overflow-hidden rounded-xl border border-blue-400/30 bg-blue-500/10 shadow-[0_0_28px_rgba(59,130,246,0.18)]">
          <img
            src="/assets/walletor-logo.jpg"
            alt=""
            className="size-14 max-w-none object-cover"
          />
        </div>
        <div>
          <div className="text-lg font-semibold tracking-[-0.03em] text-slate-50">
            Walletor
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-blue-300/70">
            <Sparkles className="size-2.5" aria-hidden="true" />
            Design preview
          </div>
        </div>
      </div>

      <nav
        aria-label="Preview navigation"
        className="mt-4 flex gap-2 overflow-x-auto pb-1 lg:mt-0 lg:block lg:overflow-visible lg:pb-0"
      >
        <p className="m-0 hidden px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600 lg:block">
          Platform
        </p>
        {primaryItems.map((item) => (
          <button
            key={item.label}
            type="button"
            aria-current={item.active ? "page" : undefined}
            className={`group relative flex min-w-max items-center gap-3 rounded-xl border px-3.5 py-3 text-sm font-medium transition duration-200 lg:mb-1.5 lg:w-full ${
              item.active
                ? "border-blue-400/30 bg-blue-500/12 text-blue-100 shadow-[inset_3px_0_0_#3b82f6,0_10px_28px_rgba(37,99,235,0.08)]"
                : "border-transparent text-slate-400 hover:border-white/8 hover:bg-white/[0.035] hover:text-slate-100"
            }`}
          >
            <item.icon
              className={`size-[18px] ${item.active ? "text-blue-400" : "text-slate-500 transition group-hover:text-blue-300"}`}
              strokeWidth={1.8}
              aria-hidden="true"
            />
            <span>{item.label}</span>
            {"badge" in item ? (
              <span className="ml-auto rounded-full border border-blue-400/20 bg-blue-400/10 px-2 py-0.5 text-[9px] font-bold tracking-[0.12em] text-blue-300">
                {item.badge}
              </span>
            ) : null}
          </button>
        ))}

        <p className="m-0 hidden px-3 pt-6 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600 lg:block">
          Manage
        </p>
        {manageItems.map((item) => (
          <button
            key={item.label}
            type="button"
            className="group flex min-w-max items-center gap-3 rounded-xl border border-transparent px-3.5 py-3 text-sm font-medium text-slate-400 transition duration-200 hover:border-white/8 hover:bg-white/[0.035] hover:text-slate-100 lg:mb-1.5 lg:w-full"
          >
            <item.icon
              className="size-[18px] text-slate-500 transition group-hover:text-blue-300"
              strokeWidth={1.8}
              aria-hidden="true"
            />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="mt-auto hidden rounded-2xl border border-white/8 bg-white/[0.025] p-3 lg:block">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          <span className="size-1.5 rounded-full bg-blue-400 shadow-[0_0_10px_#60a5fa]" />
          Static concept
        </div>
        <p className="mt-2 mb-0 text-[11px] leading-relaxed text-slate-500">
          No wallet, transaction, or API activity.
        </p>
      </div>
    </aside>
  );
}
