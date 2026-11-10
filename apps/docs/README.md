# Walletor Docs

The public Walletor documentation site. It is intentionally separate from the
DEX build and from the repository's internal `docs/` engineering records.

## Local development

```sh
npm install
npm run dev
```

From the repository root:

```sh
npm run docs:dev
```

## Verification

```sh
npm run check
npm run build
```

## Cloudflare Workers deployment

- Build from `apps/docs` with `npm run build`.
- Deploy the static output with `npx wrangler deploy`.
- Canonical domain: `www.docs.walletor.com`.
- Convenience alias: `docs.walletor.com`.

The site is static and requires no runtime secrets.
