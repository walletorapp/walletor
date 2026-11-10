# Walletor security model

## Assets and trust boundaries

- Untrusted: route params, query input, Jupiter JSON, remote image URLs, browser state, and all third-party embeds.
- Trusted only after validation: normalized Worker contracts.
- Secrets: `JUPITER_API_KEY` and `HELIUS_API_KEY`, accessible only from Worker
  bindings.
- Financial boundary: the browser can request and sign a Jupiter order but cannot author a successful trade record, fee, reward, pool balance, or distribution.
- Allocation boundary: ChatGPT and Walletor team members do not select recipients. The serialized backend applies the published formula to a locked round snapshot; finalized recipients and checksums are public and append-only.
- Local history boundary: confirmed swap receipts are convenience data in `localStorage`, scoped to the device and never presented as authoritative global or on-chain accounting.

The Worker validates Solana mints by Base58 decoding to exactly 32 bytes, URL-encodes upstream parameters, constrains buffered JSON to the expected small API shape, uses timeouts, and maps upstream errors without leaking bodies or credentials. The browser validates the Worker contract again to fail closed on accidental drift.

Swap requests validate both token mints, the taker address, exact atomic-integer amounts, signed-transaction size, and Jupiter response schemas. Swap responses use `no-store`. Only Jupiter `status: "Success"` with a transaction signature is presented as confirmed.

Security headers deny framing of Walletor, disable unnecessary browser capabilities, restrict scripts/connects to self, and allow only the approved Dexscreener chart frame. External links use validated mint paths, `https`, `target="_blank"`, and `rel="noreferrer"`.

## Abuse and availability

Discovery reduces amplification through shared caching, fixed upstream limits, bounded retry, and refresh intervals. Swap responses are never cached. Account-level Cloudflare Rate Limiting/WAF rules should be configured at staging before public launch; an isolate-local counter is intentionally not presented as authoritative distributed rate limiting.

## Later-phase requirements

User endpoints require server-issued single-use nonces and verified wallet signatures. Accepted swaps must come from finalized Solana state and be idempotent by signature plus instruction identity. Treasury keys never enter the browser, repository, logs, or ordinary D1 rows. Custody and signing work pauses until explicitly decided.
