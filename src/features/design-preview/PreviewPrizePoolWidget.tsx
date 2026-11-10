import { Info, Sparkles } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { LiquidOrb } from "./LiquidOrb";

const clock = [
  { value: "08", label: "Hours" },
  { value: "31", label: "Minutes" },
  { value: "54", label: "Seconds" },
] as const;

const stats = [
  { value: "$0.11", label: "Pool size", accent: true },
  { value: "$0.00", label: "Paid out", accent: false },
  { value: "1", label: "Eligible wallets", accent: false },
] as const;

export function PreviewPrizePoolWidget() {
  const reduceMotion = useReducedMotion();

  return (
    <section
      aria-labelledby="preview-pool-title"
      className="relative overflow-hidden rounded-[28px] border border-blue-300/20 bg-slate-950/70 p-5 shadow-[0_28px_90px_rgba(0,0,0,0.42),0_0_70px_rgba(14,165,233,0.07),inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-xl"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-52 bg-[radial-gradient(circle_at_50%_0%,rgba(14,165,233,0.12),transparent_70%)]" />
      <div className="relative flex items-center justify-center gap-2">
        <motion.span
          className="size-1.5 rounded-full bg-cyan-300 shadow-[0_0_12px_#67e8f9]"
          animate={reduceMotion ? undefined : { opacity: [0.35, 1, 0.35] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        />
        <h2
          id="preview-pool-title"
          className="m-0 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-300"
        >
          Win from the pool
        </h2>
      </div>

      <div className="relative mt-3">
        <LiquidOrb />
      </div>

      <div className="mt-2 text-center text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        Next distribution
      </div>
      <div className="mt-2 flex items-start justify-center gap-1.5">
        {clock.map((unit, index) => (
          <div key={unit.label} className="flex items-start gap-1.5">
            <div className="text-center">
              <div className="grid min-w-13 place-items-center rounded-lg border border-blue-300/20 bg-blue-400/8 px-2 py-1.5 text-xl font-semibold tabular-nums text-blue-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                {unit.value}
              </div>
              <div className="mt-1 text-[8px] font-medium text-slate-600">
                {unit.label}
              </div>
            </div>
            {index < clock.length - 1 ? (
              <span className="mt-2 text-sm font-semibold text-slate-600">
                :
              </span>
            ) : null}
          </div>
        ))}
      </div>

      <div className="mt-4">
        <div className="h-1 overflow-hidden rounded-full bg-white/[0.055]">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-blue-600 via-blue-400 to-cyan-300 shadow-[0_0_12px_rgba(56,189,248,0.45)]"
            initial={reduceMotion ? false : { width: 0 }}
            animate={{ width: "64%" }}
            transition={{ duration: reduceMotion ? 0 : 1.15, ease: "easeOut" }}
          />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[9px] font-medium text-slate-600">
          <span>Hourly round</span>
          <span>64% complete</span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-white/10 bg-white/[0.025] px-2 py-3 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]"
          >
            <div
              className={`text-lg font-semibold tabular-nums ${stat.accent ? "text-blue-300" : "text-slate-100"}`}
            >
              {stat.value}
            </div>
            <div className="mt-0.5 text-[8px] font-medium text-slate-600">
              {stat.label}
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        className="mt-3 w-full rounded-xl bg-gradient-to-r from-blue-600 via-blue-500 to-cyan-400 px-4 py-3 text-sm font-bold text-white shadow-[0_12px_34px_rgba(37,99,235,0.26)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_16px_44px_rgba(37,99,235,0.38)]"
      >
        <span className="flex items-center justify-center gap-2">
          <Sparkles className="size-4" aria-hidden="true" />
          Claim Your Earnings
        </span>
        <span className="mt-0.5 block text-[9px] font-medium text-blue-100/75">
          Round ends in 08:31:54
        </span>
      </button>

      <button
        type="button"
        className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-xs font-semibold text-slate-400 transition hover:border-blue-400/30 hover:bg-blue-500/5 hover:text-blue-200"
      >
        <Info className="size-4 text-blue-400" aria-hidden="true" />
        How it works
      </button>
    </section>
  );
}
