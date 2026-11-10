# Archived Walletor Solana claim-program prototype

This directory contains the superseded devnet-first Anchor prototype for Walletor's former SOL Prize Pool design. It is not deployed or used by the production mainnet-USDC claim flow. Production distributions use the Solana Foundation Rewards Program documented in `docs/solana-prize-pool-claims.md`.

The program provides:

- one immutable participant commitment per UTC round;
- one System Program-owned PDA vault per round;
- a Switchboard On-Demand commit/reveal binding;
- deterministic, weighted, unique winner settlement;
- one claim account per winning wallet; and
- an atomic 50 bps claim fee and net SOL payout.

## Safety boundary

The Squads treasury key is never stored in Cloudflare or this repository. A separate, balance-capped coordinator may pay transaction fees and commit a legitimate Switchboard account, but it cannot withdraw from a round vault or change a locked snapshot. Revealing randomness, settling candidates, and claiming are permissionless after their prerequisites are satisfied.

Do not deploy this prototype or interpret its configuration as production state. Any future custom-program work requires a new review, verified build, independent audit, and approved upgrade-authority design.

## Round lifecycle

1. Cloudflare closes the UTC round and publishes the immutable V2 participant checksum and Merkle root.
2. The program authority creates the matching on-chain round and funds its PDA vault with the exact SOL liability.
3. The low-balance coordinator submits a Switchboard commit instruction and `commit_randomness` in the same transaction.
4. After Switchboard is ready, one transaction submits its reveal instruction and Walletor's `reveal_randomness` instruction.
5. Anyone can submit the deterministic candidate and Merkle proof for each rank. The program derives the ticket itself and creates only the matching winner PDA.
6. A winning wallet signs `claim`; the vault atomically sends its net SOL and the fixed 50 bps fee.

The reveal and Walletor consume instructions must share a transaction because Switchboard randomness is consumed at its reveal slot. The coordinator key can commit randomness and pay transaction fees, but it is not a treasury key and cannot move vault SOL.

## Public V2 encoding

- `round_id = SHA-256(public round identifier)`
- Participant leaf domain: `WALLETOR_PARTICIPANT_V2`
- Winner ticket domain: `WALLETOR_DRAW_V2`
- All indices and integer quantities are unsigned, fixed-width, and big-endian inside hashes.
- Winner sampling uses the first 128 bits of SHA-256 plus rejection sampling.

The Rust and Worker tests share a fixed leaf and ticket vector so an encoding change cannot silently make the off-chain proof disagree with the on-chain verifier.

## Toolchain

The current Switchboard example matrix uses Anchor `0.31.1`, `switchboard-on-demand` `0.13.0`, and `@switchboard-xyz/on-demand` `3.10.x`. Versions are pinned here so an upstream update cannot silently change the program build.

## Commands

```sh
cd solana
cargo fmt --all --check
cargo test --workspace
anchor build
anchor test
```

The checked-in program ID is reserved for development. Its keypair belongs only in the ignored `solana/target/deploy` directory and must never be committed.
