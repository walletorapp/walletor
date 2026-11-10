import { z } from "zod";
import type { LaunchToken } from "../../shared/launch-contracts";
import { isSolanaAddress } from "../lib/solana";
import { getHeliusLaunchMetadata } from "./helius-assets";
import { launchLink } from "../lib/launch-links";

// Fetch metadata only through fixed public content-addressed gateways. Token
// supplied URLs never become arbitrary Worker fetch destinations.
export function launchMetadataUrl(value: string | undefined): string | null {
  if (!value) return null;
  let path: string | undefined;
  if (value.startsWith("ipfs://")) path = value.slice(7).replace(/^ipfs\//, "");
  else {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password || url.port)
        return null;
      if (url.hostname === "arweave.net" && /^\/[\w-]{43}$/.test(url.pathname))
        return `https://arweave.net${url.pathname}`;
      const prefix = url.pathname.indexOf("/ipfs/");
      if (prefix >= 0) path = url.pathname.slice(prefix + 6);
      else if (url.hostname.includes(".ipfs."))
        path =
          (url.hostname.split(".ipfs.")[0] ?? "") +
          (url.pathname === "/" ? "" : url.pathname);
    } catch {
      return null;
    }
  }
  if (
    !path ||
    !/^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,120})(?:\/[a-zA-Z0-9._~%/-]+)?$/.test(
      path,
    ) ||
    path.includes("..")
  )
    return null;
  return `https://ipfs.io/ipfs/${path}`;
}

export function launchImageUrl(value: string | undefined): string | null {
  if (!value) return null;
  if (value.startsWith("ipfs://")) return launchMetadataUrl(value);
  try {
    const url = new URL(value);
    const host = url.hostname;
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !host.includes(".") ||
      host.includes(":") ||
      /^[\d.]+$/.test(host) ||
      /\.(?:local|internal|localhost)$/.test(host)
    )
      return null;
    if (
      (url.hostname === "api.vortexdeployer.com" &&
        /^\/metadata\/[a-f0-9-]{36}\.json$/.test(url.pathname)) ||
      (url.hostname === "metadata.j7tracker.io" &&
        /^\/metadata\/[a-f0-9]{16}\.json$/.test(url.pathname)) ||
      (url.hostname.endsWith(".public.blob.vercel-storage.com") &&
        /^\/[\w./-]{1,300}$/.test(url.pathname))
    )
      return url.toString();
    return url.toString();
  } catch {
    return null;
  }
}

const entrySchema = z.object({
  mint: z.string().refine(isSolanaAddress),
  uri: z.string().max(2048),
  logoUrl: z.url().nullable(),
  at: z.number().int().nonnegative(),
  websiteUrl: z.url().nullish(),
  twitterUrl: z.url().nullish(),
  telegramUrl: z.url().nullish(),
  name: z.string().max(120).nullish(),
  symbol: z.string().max(24).nullish(),
  linksChecked: z.boolean().optional(),
  fetchVersion: z.number().int().optional(),
});
type Entry = z.infer<typeof entrySchema>;
interface Store {
  get: () => Promise<unknown>;
  put: (entries: Entry[]) => Promise<void>;
}

async function metadataImage(
  response: Response,
): Promise<Pick<
  Entry,
  "logoUrl" | "websiteUrl" | "twitterUrl" | "telegramUrl"
> | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        return null;
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const parsed = z
      .object({
        image: z.string().max(2048).nullish(),
        website: z.string().max(2048).nullish(),
        twitter: z.string().max(2048).nullish(),
        telegram: z.string().max(2048).nullish(),
      })
      .safeParse(JSON.parse(new TextDecoder().decode(bytes)));
    return parsed.success
      ? {
          logoUrl: launchImageUrl(parsed.data.image ?? undefined),
          websiteUrl: launchLink(parsed.data.website),
          twitterUrl: launchLink(parsed.data.twitter, "twitter"),
          telegramUrl: launchLink(parsed.data.telegram, "telegram"),
        }
      : null;
  } catch {
    return null;
  }
}

export class LaunchLogos {
  private entries = new Map<string, Entry>();
  private running: Promise<void> | null = null;
  constructor(
    private readonly store: Store,
    private readonly fetcher: typeof fetch = fetch,
    private readonly indexed?: {
      apiKey: string;
      reserve: () => Promise<boolean>;
    },
  ) {}

  async load() {
    const parsed = z
      .array(entrySchema)
      .max(400)
      .safeParse(await this.store.get());
    if (parsed.success)
      this.entries = new Map(parsed.data.map((entry) => [entry.mint, entry]));
  }

  apply(tokens: LaunchToken[], now = Date.now()) {
    for (const token of tokens) {
      const entry = this.entries.get(token.mint);
      if (
        entry &&
        entry.at <= now &&
        now - entry.at < 86400000 &&
        entry.uri === (launchMetadataUrl(token.metadataUri) ?? "")
      ) {
        token.logoUrl ??= entry.logoUrl;
        token.websiteUrl ??= entry.websiteUrl;
        token.twitterUrl ??= entry.twitterUrl;
        token.telegramUrl ??= entry.telegramUrl;
        if (token.eventType === "migration") {
          token.name = entry.name ?? token.name;
          token.symbol = entry.symbol ?? token.symbol;
        }
      }
    }
  }

  refresh(tokens: LaunchToken[], now = Date.now()): Promise<void> {
    if (this.running) return this.running;
    this.running = this.run(tokens, now).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(tokens: LaunchToken[], now: number) {
    const selected = tokens
      .flatMap((token) => {
        const uri = launchMetadataUrl(token.metadataUri);
        const old = this.entries.get(token.mint);
        if (
          (token.logoUrl && old?.linksChecked) ||
          !isSolanaAddress(token.mint) ||
          !uri ||
          (old?.uri === uri &&
            old.fetchVersion === 1 &&
            now - old.at <
              (old.logoUrl && old.linksChecked ? 86400000 : 300000))
        )
          return [];
        return [{ mint: token.mint, uri }];
      })
      .slice(0, 20);
    let changed = selected.length > 0;
    const fetcher = this.fetcher;
    for (let offset = 0; offset < selected.length; offset += 5) {
      await Promise.all(
        selected.slice(offset, offset + 5).map(async (item) => {
          let metadata: Awaited<ReturnType<typeof metadataImage>> = null;
          try {
            const response = await fetcher(item.uri, {
              signal: AbortSignal.timeout(2500),
              redirect: "manual",
              headers: { accept: "application/json" },
            });
            if (response.ok) metadata = await metadataImage(response);
            else await response.body?.cancel();
          } catch {
            console.warn("LAUNCH_LOGO_METADATA_UNAVAILABLE");
          }
          this.entries.set(item.mint, {
            ...this.entries.get(item.mint),
            ...item,
            ...metadata,
            logoUrl:
              metadata?.logoUrl ??
              tokens.find((token) => token.mint === item.mint)?.logoUrl ??
              this.entries.get(item.mint)?.logoUrl ??
              null,
            linksChecked: metadata !== null,
            fetchVersion: 1,
            at: now,
          });
        }),
      );
    }
    const pending = tokens.filter(
      (token) =>
        (!token.logoUrl ||
          (token.eventType === "migration" && token.symbol === "TOKEN")) &&
        !(
          this.entries.get(token.mint)?.logoUrl &&
          (token.eventType !== "migration" ||
            this.entries.get(token.mint)?.symbol) &&
          now - (this.entries.get(token.mint)?.at ?? 0) < 86400000
        ),
    );
    if (pending.length && this.indexed?.apiKey) {
      try {
        if (await this.indexed.reserve()) {
          const logos = await getHeliusLaunchMetadata(
            pending.map((token) => token.mint),
            this.indexed.apiKey,
            this.fetcher,
          );
          for (const [mint, indexed] of logos) {
            const logoUrl = launchImageUrl(indexed.logoUrl ?? undefined);
            const token = pending.find((item) => item.mint === mint);
            if ((logoUrl || indexed.name || indexed.symbol) && token) {
              this.entries.set(mint, {
                ...this.entries.get(mint),
                mint,
                uri: launchMetadataUrl(token.metadataUri) ?? "",
                logoUrl,
                name: indexed.name,
                symbol: indexed.symbol,
                at: now,
              });
              changed = true;
            }
          }
        }
      } catch {
        console.warn("LAUNCH_LOGO_INDEX_BUDGET_UNAVAILABLE");
      }
    }
    if (!changed) return;
    const entries = [...this.entries.values()]
      .sort((a, b) => b.at - a.at)
      .slice(0, 400);
    this.entries = new Map(entries.map((entry) => [entry.mint, entry]));
    try {
      await this.store.put(entries);
    } catch {
      console.warn("LAUNCH_LOGO_CACHE_UNAVAILABLE");
    }
  }
}
