import { useQuery } from "@tanstack/react-query";

import { fetchPrizePoolState } from "../../lib/api";

export const prizePoolQueryKey = ["prize-pool", "public-state"] as const;

export function usePrizePoolState() {
  return useQuery({
    queryKey: prizePoolQueryKey,
    queryFn: ({ signal }) => fetchPrizePoolState(signal),
    staleTime: 30_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
}
