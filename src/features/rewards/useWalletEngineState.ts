import { useQuery } from "@tanstack/react-query";

import { fetchWalletEngineState } from "../../lib/api";

export const walletEngineQueryKey = (walletAddress: string | null) =>
  ["wallet-engine", walletAddress] as const;

export function useWalletEngineState(walletAddress: string | null) {
  return useQuery({
    queryKey: walletEngineQueryKey(walletAddress),
    queryFn: ({ signal }) => {
      if (!walletAddress) throw new Error("A wallet address is required.");
      return fetchWalletEngineState(walletAddress, signal);
    },
    enabled: walletAddress !== null,
    staleTime: 15_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
}
