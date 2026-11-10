# Walletor repository guide

## Boundaries

- Keep this repository independent of third-party app-builder runtimes and plugin imports.
- Browser code may read public normalized API contracts only. It must never author authoritative trades, fees, balances, allocations, or claims.
- Keep secrets in Worker bindings. Never expose `JUPITER_API_KEY` through Vite variables, client bundles, logs, fixtures, or Git.
- Swaps may use Jupiter Swap V2 only when the wallet signs the returned transaction and Jupiter reports the execution result. Never infer success from a click or timer.
- Keep Walletor fees, revenue accounting, rewards, claims, and treasury behavior disabled or explicitly marked demo until an approved custody and accounting design exists.
- Validate external data at the Worker boundary and Solana mint addresses before upstream requests or external-link construction.
- Financial quantities must eventually use atomic integers or exact decimals, never JavaScript floating point for accounting.

## Conventions

- TypeScript strict mode; no `any`, unsafe double casts, swallowed errors, or floating promises.
- Feature UI belongs under `src/features`; shared contracts under `shared`; upstream and HTTP code under `worker`.
- Preserve accessible semantics, visible focus, keyboard use, reduced-motion support, and honest loading/error/empty/degraded states.
- Use lowercase semantic routes such as `/trenches` and `/tokens/:address`.
  Preserve `/new-tokens` as a redirect to `/trenches`.
- Use `apply_patch` for intentional edits. Keep generated output and local secrets untracked.

## Approved verification

```sh
npm ci
npm run cf-typegen
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm run test:e2e
```

Before handoff, also verify that `rg -n "JUPITER_API_KEY" src dist/client` finds no bundled secret, and test direct SPA navigation with `npm run preview`.
