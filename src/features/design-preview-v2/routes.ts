export const walletorRoutes = {
  home: "/",
  launches: "/trenches",
  stocksRwa: "/stocks-rwa",
  airdrop: "/airdrop",
  claim: "/claim-rewards",
  prizePool: "/prize-pool",
  rewards: "/rewards",
  history: "/history",
} as const;

export function walletorTokenRoute(address: string): string {
  return `/tokens/${encodeURIComponent(address)}`;
}
