# Walletor MagicBlock randomness consumer

This directory contains the Solana randomness consumer used by the Walletor draw
adapter. Its source program ID is `DpJmR1usbiC7CaPZsfxqcMosx4ELCtgY9TXC7ijjmoY2`.
The public snapshot does not configure a deployment signer or run live draws.

## Design

- One draw account binds an authority, round hash and locked snapshot hash.
- The request initializes the account and requests MagicBlock randomness atomically.
- The callback authenticates MagicBlock's per-consumer signer PDA and the allowed
  queue, verifies both hashes and accepts only one response.
- No reset, close or reroll instruction is provided for a draw.
- The Worker independently validates account ownership, layout, identifiers,
  request/callback evidence and the immutable round binding.

The test-oracle program is a local test double. It is used to exercise CPI signer
authentication and replay protection; it is not a production randomness provider.

## Build and test locally

Install Rust and the Solana SBF toolchain, then run:

```sh
cargo-build-sbf --tools-version v1.52 --manifest-path solana-randomness/Cargo.toml
cargo-build-sbf --tools-version v1.52 --manifest-path solana-randomness/test-oracle/Cargo.toml
cargo test --manifest-path solana-randomness/Cargo.toml --locked
```

These commands build and run the local harness. Deployment scripts, signer
keypairs, historical incident reports and production runbooks are maintained
separately from this public snapshot.
