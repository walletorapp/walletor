# Dependency review

Checked on 10 November 2026 using npm's advisory service. Counts describe this
snapshot's lockfiles and can change as new advisories are published.

Compatible updates were applied with `npm audit fix --ignore-scripts`; the root
Zod dependency was also updated within version 4. No forced SDK downgrades or
untested major-version overrides were applied. The live website's dependencies
were not changed by this publication.

## Remaining advisories

| Dependency set                           | Critical | High | Moderate | Low | Total flagged packages |
| ---------------------------------------- | -------: | ---: | -------: | --: | ---------------------: |
| Root, production dependencies            |        0 |   19 |        5 |   4 |                     28 |
| Root, including development dependencies |        0 |   19 |       15 |   4 |                     38 |
| Documentation app                        |        0 |    0 |        0 |   0 |                      0 |

These are affected-package counts, including transitive parents, not a count of
distinct exploitable issues in Walletor. A passing build does not establish
whether a vulnerable dependency path is reachable.

The remaining root findings include:

- [`bigint-buffer`](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg), through Solana dependencies.
- [`decode-uri-component`](https://github.com/advisories/GHSA-qr28-fpjm-wq7f) and
  [`elliptic`](https://github.com/advisories/GHSA-848j-6mx2-7j84), through wallet connection dependencies.
- [`image-size`](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq), in the React Native/Metro peer dependency tree.
- [`stream-json`](https://github.com/advisories/GHSA-mjw6-4jj6-33hc), through JSON-RPC/wallet dependencies.
- [`toml`](https://github.com/advisories/GHSA-v5mp-jgw5-2x6j), through Anchor/referral SDK dependencies.
- An older nested [`zod`](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) dependency in Reown AppKit; the root Zod dependency has been updated.

The list links representative advisories; run the commands below for the complete
current set. Resolve and test the affected dependency chains before adapting
this snapshot for a production deployment. The example financial integrations
remain disabled.

```sh
npm audit
npm audit --omit=dev
npm audit --prefix apps/docs
npm explain bigint-buffer
```

This is a dependency inventory and publication review, not an independent
security audit or assurance that the application is vulnerability-free.
