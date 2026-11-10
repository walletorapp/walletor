import { useQuery } from "@tanstack/react-query";

import { fetchClaimRewardsState } from "../../lib/api";

export function useClaimRewardsState(walletAddress: string | null) {
  return useQuery({
    queryKey: ["claim-rewards", walletAddress],
    queryFn: ({ signal }) => {
      if (walletAddress === null) {
        throw new Error("A connected wallet is required.");
      }
      return fetchClaimRewardsState(walletAddress, signal);
    },
    enabled: walletAddress !== null,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}
