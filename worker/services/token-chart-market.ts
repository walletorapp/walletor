import { z } from "zod";
import type { TokenChartMarket } from "../../shared/token-market-contracts";
import { ApiFailure } from "../lib/http";
import { isSolanaAddress } from "../lib/solana";

const pairSchema = z.object({
  chainId: z.literal("solana"),
  pairAddress: z.string().refine(isSolanaAddress),
  baseToken: z.object({ address: z.string().refine(isSolanaAddress) }),
  liquidity: z.object({ usd: z.number().nonnegative().nullish() }).nullish(),
});

export async function getTokenChartMarket(
  mint: string,
  fetcher: typeof fetch = fetch,
): Promise<TokenChartMarket> {
  if (!isSolanaAddress(mint)) {
    throw new ApiFailure(
      400,
      "INVALID_SOLANA_ADDRESS",
      "Enter a valid Solana token mint address.",
      false,
    );
  }
  try {
    const response = await fetcher(
      `https://api.dexscreener.com/tokens/v1/solana/${mint}`,
      {
        signal: AbortSignal.timeout(5000),
        redirect: "manual",
        cf: { cacheTtl: 30, cacheEverything: true },
      },
    );
    if (!response.ok) throw new Error("CHART_MARKET_HTTP");
    const raw = z
      .array(z.unknown())
      .max(2000)
      .parse(await response.json());
    const pairs = raw.flatMap((item) => {
      const parsed = pairSchema.safeParse(item);
      return parsed.success && parsed.data.baseToken.address === mint
        ? [parsed.data]
        : [];
    });
    // A quote-token match would show another token's price chart. Only chart
    // pools whose base token is exactly the requested mint.
    const selected = pairs.sort(
      (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0),
    )[0];
    return { mint, pairAddress: selected?.pairAddress ?? null };
  } catch {
    throw new ApiFailure(
      502,
      "CHART_MARKET_UNAVAILABLE",
      "The token chart market could not be loaded. Try again shortly.",
      true,
    );
  }
}
