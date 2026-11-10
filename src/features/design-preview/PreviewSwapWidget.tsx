import {
  ChevronDown,
  Clock3,
  Repeat2,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { useState } from "react";

function SolanaMark({ className = "size-8" }: { className?: string }) {
  return (
    <img
      src="/assets/solana-logo.svg"
      alt=""
      className={`${className} shrink-0`}
    />
  );
}

function UsdcMark({ className = "size-8" }: { className?: string }) {
  return (
    <span
      className={`${className} grid shrink-0 place-items-center rounded-full bg-[#2775ca] text-[0.55em] font-bold text-white ring-2 ring-white/80`}
      aria-hidden="true"
    >
      $
    </span>
  );
}

export function PreviewSwapWidget() {
  const [amount, setAmount] = useState("");
  const hasAmount = Number.parseFloat(amount) > 0;

  return (
    <section
      aria-labelledby="preview-swap-title"
      className="relative overflow-hidden rounded-[28px] border border-blue-400/20 bg-slate-950/70 p-3 shadow-[0_28px_90px_rgba(0,0,0,0.42),0_0_60px_rgba(37,99,235,0.06),inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-xl sm:p-5"
    >
      <div className="pointer-events-none absolute -top-28 -left-28 size-80 rounded-full bg-blue-600/[0.055] blur-3xl" />
      <h2 id="preview-swap-title" className="sr-only">
        Swap preview
      </h2>

      <div className="relative flex flex-wrap items-center justify-between gap-3 pb-4">
        <div className="flex items-center gap-1 rounded-xl border border-white/8 bg-black/25 p-1">
          <button
            type="button"
            className="rounded-lg border border-blue-400/30 bg-blue-500/15 px-4 py-2 text-xs font-semibold text-blue-100 shadow-[0_4px_18px_rgba(59,130,246,0.1)]"
          >
            Market
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.035] px-3 text-xs font-semibold text-slate-300 transition hover:border-blue-400/30"
          >
            <SolanaMark className="size-4" />
            Solana
          </button>
          <button
            type="button"
            className="flex h-10 items-center gap-2 rounded-xl border border-blue-400/25 bg-blue-500/8 px-3 text-xs font-semibold text-blue-200 transition hover:border-blue-300/50"
          >
            <Sparkles className="size-4" aria-hidden="true" />
            Ultra
          </button>
          <button
            type="button"
            aria-label="Preview history"
            className="grid size-10 place-items-center rounded-xl border border-white/10 bg-white/[0.025] text-slate-500 transition hover:text-blue-300"
          >
            <Clock3 className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Preview settings"
            className="grid size-10 place-items-center rounded-xl border border-white/10 bg-white/[0.025] text-slate-500 transition hover:text-blue-300"
          >
            <SlidersHorizontal className="size-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="relative rounded-2xl border border-blue-300/15 bg-slate-800/45 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-slate-200">Sell</span>
          <div className="flex items-center gap-2 text-[11px] font-medium text-slate-500">
            <span className="hidden sm:inline">Balance: 0.4457 SOL</span>
            <button
              type="button"
              onClick={() => {
                setAmount("0.22285");
              }}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 font-semibold text-slate-400 transition hover:border-blue-400/30 hover:text-blue-200"
            >
              HALF
            </button>
            <button
              type="button"
              onClick={() => {
                setAmount("0.4457");
              }}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 font-semibold text-slate-400 transition hover:border-blue-400/30 hover:text-blue-200"
            >
              MAX
            </button>
          </div>
        </div>
        <div className="mt-7 flex items-end justify-between gap-4">
          <button
            type="button"
            className="flex h-13 items-center gap-2.5 rounded-xl border border-white/10 bg-slate-900/80 px-3.5 text-sm font-semibold text-slate-100 transition hover:border-blue-400/35"
          >
            <SolanaMark className="size-6" />
            SOL
            <ChevronDown className="size-4 text-slate-500" aria-hidden="true" />
          </button>
          <div className="min-w-0 flex-1 text-right">
            <label className="sr-only" htmlFor="preview-sell-amount">
              Mock sell amount
            </label>
            <input
              id="preview-sell-amount"
              inputMode="decimal"
              value={amount}
              onChange={(event) => {
                setAmount(event.currentTarget.value);
              }}
              placeholder="0.00"
              className="w-full border-0 bg-transparent text-right text-4xl font-medium tracking-[-0.05em] text-slate-100 outline-none placeholder:text-slate-600 sm:text-[42px]"
            />
            <div className="mt-1 text-xs text-slate-600">
              {hasAmount ? "$34.26" : "$0.00"}
            </div>
          </div>
        </div>
      </div>

      <div className="relative z-10 -my-4 flex justify-center">
        <button
          type="button"
          aria-label="Reverse preview tokens"
          className="grid size-10 place-items-center rounded-xl border-4 border-[#080d16] bg-blue-500/15 text-blue-300 shadow-[0_0_20px_rgba(59,130,246,0.12)] transition hover:rotate-180 hover:bg-blue-500/25"
        >
          <Repeat2 className="size-4 rotate-90" aria-hidden="true" />
        </button>
      </div>

      <div className="relative rounded-2xl border border-blue-300/15 bg-slate-900/55 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-slate-200">Buy</span>
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-blue-300/75">
            <span className="grid size-3.5 place-items-center rounded-full bg-blue-400 text-[8px] font-black text-slate-950">
              ✓
            </span>
            Verified token
          </span>
        </div>
        <div className="mt-7 flex items-end justify-between gap-4">
          <button
            type="button"
            className="flex h-13 items-center gap-2.5 rounded-xl border border-white/10 bg-slate-900/80 px-3.5 text-sm font-semibold text-slate-100 transition hover:border-blue-400/35"
          >
            <UsdcMark className="size-6" />
            USDC
            <ChevronDown className="size-4 text-slate-500" aria-hidden="true" />
          </button>
          <div className="text-right">
            <div className="text-4xl font-medium tracking-[-0.05em] text-slate-100 sm:text-[42px]">
              {hasAmount ? "33.91" : "0.00"}
            </div>
            <div className="mt-1 text-xs text-slate-600">
              {hasAmount ? "$33.91" : "$0.00"}
            </div>
          </div>
        </div>
      </div>

      <div className="relative mt-3 rounded-xl border border-white/8 bg-black/25 px-4 py-3 text-xs text-slate-500">
        {hasAmount
          ? "Static preview quote · no transaction will be created"
          : "Enter an amount to preview the active state"}
      </div>
      <button
        type="button"
        className={`relative mt-2 h-14 w-full overflow-hidden rounded-xl text-sm font-bold transition duration-300 ${
          hasAmount
            ? "bg-gradient-to-r from-blue-600 via-blue-500 to-cyan-400 text-white shadow-[0_14px_40px_rgba(37,99,235,0.26)] hover:-translate-y-0.5 hover:shadow-[0_18px_48px_rgba(37,99,235,0.38)]"
            : "border border-blue-400/10 bg-blue-500/8 text-blue-200/45"
        }`}
      >
        {hasAmount ? "Swap preview" : "Enter an amount to get a quote"}
      </button>
    </section>
  );
}
