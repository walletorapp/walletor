# USDC claim integration source

Walletor's current claim integration is implemented in the Worker services:

- `worker/services/usdc-claims.ts` handles prepared and staged distributions.
- `worker/services/solana-claims.ts` provides the wallet-facing claim state.
- `worker/services/rewards-program-verification.ts` validates program and transaction evidence.

The integration requires the official USDC mint, expected program identities,
finalized transactions, exact atomic amounts and a matching distribution record.
Wallet claims require the winning wallet's signature. A displayed pool estimate
does not create a funded entitlement.

The `solana/` directory is an archived prototype; it is not the source of the
external mainnet Rewards Program. The `solana-randomness/` directory contains
Walletor's MagicBlock consumer implementation.

The public example configuration disables funding and payouts and includes no
signer or treasury credentials. Deployment verification and production funding
procedures are maintained separately. This source snapshot does not certify a
deployed binary or an external program audit.
