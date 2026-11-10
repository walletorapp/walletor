import { z } from "zod";

const STORAGE_KEY = "walletor.confirmed-swaps.v2";
const PRELAUNCH_STORAGE_KEY = "walletor.confirmed-swaps.v1";
const tokenSchema = z.object({
  symbol: z.string().min(1).max(24),
  mint: z.string().min(32).max(44),
});
const historyEntrySchema = z.object({
  signature: z.string().min(20).max(120),
  confirmedAt: z.iso.datetime(),
  wallet: z.string().min(32).max(44),
  inputToken: tokenSchema,
  outputToken: tokenSchema,
  inputAmount: z.string().min(1).max(80),
  outputAmount: z.string().min(1).max(80),
  inputUsdValue: z.number().nonnegative().nullable(),
});

export type SwapHistoryEntry = z.infer<typeof historyEntrySchema>;

export function loadSwapHistory(): SwapHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    localStorage.removeItem(PRELAUNCH_STORAGE_KEY);
    const parsed: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "[]",
    );
    const result = z.array(historyEntrySchema).safeParse(parsed);
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

export function saveSwapHistory(entries: SwapHistoryEntry[]): void {
  localStorage.removeItem(PRELAUNCH_STORAGE_KEY);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, 50)));
}
