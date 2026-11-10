import { Eye } from "lucide-react";

import { PreviewHeader } from "./PreviewHeader";
import { PreviewPrizePoolWidget } from "./PreviewPrizePoolWidget";
import { PreviewSidebar } from "./PreviewSidebar";
import { PreviewSwapWidget } from "./PreviewSwapWidget";
import "./preview.css";

export function WalletorDesignPreview() {
  return (
    <div className="walletor-design-preview min-h-screen overflow-x-hidden bg-[#03060b] text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_57%_20%,rgba(37,99,235,0.08),transparent_30%),radial-gradient(circle_at_88%_52%,rgba(6,182,212,0.045),transparent_24%)]" />
      <div className="pointer-events-none fixed inset-0 opacity-[0.018] [background-image:linear-gradient(rgba(255,255,255,.8)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.8)_1px,transparent_1px)] [background-size:72px_72px]" />

      <PreviewSidebar />
      <PreviewHeader />

      <main className="relative px-3 py-5 sm:px-5 lg:ml-[236px] lg:min-h-screen lg:px-7 lg:pt-[106px] lg:pb-7">
        <div className="mx-auto max-w-[1240px]">
          <div className="mb-3 flex items-center justify-between gap-4 px-1">
            <h1 className="sr-only">Swap and rewards dashboard</h1>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-blue-300/70">
              <Eye className="size-3.5" aria-hidden="true" />
              Walletor interface concept
            </div>
            <div className="rounded-full border border-blue-400/20 bg-blue-400/8 px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-blue-300">
              Static · no transactions
            </div>
          </div>

          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.78fr)]">
            <PreviewSwapWidget />
            <PreviewPrizePoolWidget />
          </div>
        </div>
      </main>
    </div>
  );
}
