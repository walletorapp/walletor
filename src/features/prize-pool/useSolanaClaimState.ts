import { useQuery } from "@tanstack/react-query";

import { fetchSolanaClaimState } from "../../lib/solana-claims";

export function solanaClaimQueryKey(walletAddress: string | null) {
  return ["solana-claims", walletAddress] as const;
}

export function useSolanaClaimState(walletAddress: string | null) {
  return useQuery({
    queryKey: solanaClaimQueryKey(walletAddress),
    queryFn: ({ signal }) => {
      if (walletAddress === null) {
        throw new Error("A connected wallet is required.");
      }
      return fetchSolanaClaimState(walletAddress, signal);
    },
    enabled: walletAddress !== null,
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
}
