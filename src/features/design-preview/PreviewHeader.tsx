import { Search, WalletCards } from "lucide-react";

export function PreviewHeader() {
  return (
    <header className="relative z-10 grid min-h-[78px] grid-cols-1 items-center gap-3 border-b border-white/10 bg-[#070b13]/75 px-4 py-3 backdrop-blur-xl sm:grid-cols-[1fr_auto] lg:fixed lg:top-0 lg:right-0 lg:left-[236px] lg:grid-cols-[minmax(180px,1fr)_minmax(300px,560px)_minmax(220px,1fr)] lg:px-7">
      <div className="hidden lg:block">
        <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600">
          Total paid out
        </div>
        <div className="mt-1 text-sm font-medium text-slate-400">
          All-time rewards <span className="ml-1 text-blue-300">$0.00</span>
        </div>
      </div>

      <label className="group flex h-12 items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/70 px-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition focus-within:border-blue-400/40 focus-within:shadow-[0_0_28px_rgba(59,130,246,0.1)] sm:col-span-1">
        <Search
          className="size-5 shrink-0 text-slate-500 transition group-focus-within:text-blue-300"
          strokeWidth={1.8}
          aria-hidden="true"
        />
        <span className="sr-only">Search tokens</span>
        <input
          type="search"
          placeholder="Search tokens or paste a mint"
          className="min-w-0 flex-1 border-0 bg-transparent text-sm text-slate-200 outline-none placeholder:text-slate-600"
        />
        <span className="hidden rounded-md border border-white/8 bg-white/[0.035] px-2 py-1 text-[9px] font-semibold text-slate-600 sm:inline">
          ⌘ K
        </span>
      </label>

      <div className="flex justify-end">
        <button
          type="button"
          className="flex h-11 items-center gap-2.5 rounded-xl border border-blue-400/30 bg-blue-500/10 px-4 text-xs font-semibold text-blue-100 shadow-[0_0_24px_rgba(59,130,246,0.08)] transition hover:border-blue-300/50 hover:bg-blue-500/15"
        >
          <span className="grid size-6 place-items-center rounded-lg bg-gradient-to-br from-blue-400 to-cyan-300 text-[#06101e]">
            <WalletCards className="size-3.5" aria-hidden="true" />
          </span>
          Phantom · Ho3t…
        </button>
      </div>
    </header>
  );
}
