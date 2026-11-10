# Tangem connection

Tangem is offered in the standard Connect Wallet selector using Walletor's public
WalletConnect project ID. `VITE_WALLETCONNECT_PROJECT_ID` can override it at build
time; an empty value disables the option. It uses the Solana
WalletConnect adapter on mainnet, with support for legacy and versioned
transactions and message signing. Existing swap and claim paths continue to
request signatures from the selected wallet; this does not change custody or
reward eligibility.

## Activation

1. Manage the Walletor project at https://dashboard.walletconnect.com and copy its public
   project ID. Do not use an API secret or an example project's ID.
2. Add `https://walletor.com` to the project's domain allowlist, plus the exact
   local development origin when testing locally.
3. Set `VITE_WALLETCONNECT_PROJECT_ID` in the build environment (or `.env.local`).
   Build again. This ID is intentionally public; it is not a Worker secret.
4. Test Tangem connection, rejection, disconnection, and reconnection on desktop
   and mobile. In the WalletConnect picker choose Tangem, or scan its QR code
   using Tangem's WalletConnect screen. Signing requires approval in Tangem.
5. Verify a real versioned Jupiter transaction and a claim with the owner before
   advertising full support. Connecting alone does not prove hardware signing.

No automatic connection prompt opens on page load. Users explicitly select
Tangem again after reload. The transport picker can show other WalletConnect
wallets; the Tangem label is an entry point, not an attestation of wallet brand.
The icon is a generic hardware-card illustration.

Sources:

- https://tangem.com/en/help-center/tangem-dapps/
- https://github.com/anza-xyz/wallet-adapter
- https://docs.reown.com/cloud/relay

The owner supplied the project ID on October 1, 2026. The WalletConnect wallet
directory accepts it for the Walletor origin and lists Tangem with Solana support.
Real Tangem device pairing and transaction-signing validation still require the
owner's device. Automated tests use a mocked transport and do not prove hardware
compatibility.
