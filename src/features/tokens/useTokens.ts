import { useQuery } from "@tanstack/react-query";

import { fetchToken } from "../../lib/api";

export function useToken(address: string) {
  return useQuery({
    queryKey: ["tokens", "detail", address],
    queryFn: ({ signal }) => fetchToken(address, signal),
    enabled: Boolean(address),
    refetchInterval: 45_000,
  });
}
