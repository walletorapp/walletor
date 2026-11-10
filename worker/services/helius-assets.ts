import { z } from "zod";

import { isSolanaAddress } from "../lib/solana";

const HELIUS_MAINNET_RPC_URL = "https://mainnet.helius-rpc.com/";
const HELIUS_TIMEOUT_MS = 3_000;
const MAX_RESPONSE_BYTES = 1_000_000;

type Fetcher = typeof fetch;

const heliusAssetEnvelopeSchema = z.object({
  result: z
    .object({
      id: z.string(),
      content: z
        .object({
          files: z
            .array(
              z.object({
                uri: z.string().optional(),
                cdn_uri: z.string().optional(),
              }),
            )
            .optional(),
          links: z.object({ image: z.string().optional() }).optional(),
          metadata: z
            .object({
              name: z.string().optional(),
              symbol: z.string().optional(),
            })
            .optional(),
        })
        .optional(),
      token_info: z
        .object({ decimals: z.number().int().optional() })
        .optional(),
    })
    .nullable()
    .optional(),
  error: z.unknown().optional(),
});

export interface HeliusTokenMetadata {
  mint: string;
  logoUrl: string | null;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
}

function normalizedHttpsUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizedText(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized?.length ? normalized : null;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    return null;
  }

  const reader = response.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  let result = await reader.read();
  while (!result.done) {
    byteLength += result.value.byteLength;
    if (byteLength > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(result.value);
    result = await reader.read();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
}

export async function getHeliusTokenMetadata(
  mint: string,
  apiKey: string | undefined,
  fetcher: Fetcher = fetch,
): Promise<HeliusTokenMetadata | null> {
  const normalizedKey = apiKey?.trim();
  if (!normalizedKey || !isSolanaAddress(mint)) return null;

  try {
    const response = await fetcher(
      `${HELIUS_MAINNET_RPC_URL}?api-key=${encodeURIComponent(normalizedKey)}`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "walletor-token-metadata",
          method: "getAsset",
          params: {
            id: mint,
            displayOptions: { showFungible: true },
          },
        }),
        signal: AbortSignal.timeout(HELIUS_TIMEOUT_MS),
      },
    );
    if (!response.ok) return null;

    const parsed = heliusAssetEnvelopeSchema.safeParse(
      await readBoundedJson(response),
    );
    if (!parsed.success || parsed.data.error || !parsed.data.result)
      return null;
    const asset = parsed.data.result;
    if (asset.id !== mint) return null;

    const files = asset.content?.files ?? [];
    const logoUrl =
      files.map((file) => normalizedHttpsUrl(file.cdn_uri)).find(Boolean) ??
      normalizedHttpsUrl(asset.content?.links?.image) ??
      files.map((file) => normalizedHttpsUrl(file.uri)).find(Boolean) ??
      null;

    return {
      mint,
      logoUrl,
      name: normalizedText(asset.content?.metadata?.name),
      symbol: normalizedText(asset.content?.metadata?.symbol),
      decimals: asset.token_info?.decimals ?? null,
    };
  } catch {
    return null;
  }
}

export async function getHeliusLaunchMetadata(
  mints: string[],
  apiKey: string,
  fetcher: Fetcher = fetch,
): Promise<
  Map<string, Pick<HeliusTokenMetadata, "logoUrl" | "name" | "symbol">>
> {
  const ids = [...new Set(mints.filter(isSolanaAddress))].slice(0, 80);
  const logos = new Map<
    string,
    Pick<HeliusTokenMetadata, "logoUrl" | "name" | "symbol">
  >();
  if (!apiKey.trim() || !ids.length) return logos;
  try {
    const response = await fetcher(
      `${HELIUS_MAINNET_RPC_URL}?api-key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "launch-logos",
          method: "getAssetBatch",
          params: { ids, options: { showFungible: true } },
        }),
        signal: AbortSignal.timeout(3000),
        redirect: "manual",
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      return logos;
    }
    const envelope = z
      .object({ result: z.array(z.unknown()).max(80) })
      .safeParse(await readBoundedJson(response));
    if (!envelope.success) return logos;
    for (const value of envelope.data.result) {
      const parsed = z
        .object({
          id: z.string(),
          content: z
            .object({
              files: z
                .array(
                  z.object({
                    uri: z.string().nullish(),
                    cdn_uri: z.string().nullish(),
                  }),
                )
                .max(100)
                .nullish(),
              links: z.object({ image: z.string().nullish() }).nullish(),
              metadata: z
                .object({
                  name: z.string().nullish(),
                  symbol: z.string().nullish(),
                })
                .nullish(),
            })
            .nullish(),
        })
        .safeParse(value);
      const asset = parsed.success ? parsed.data : null;
      if (!asset || !ids.includes(asset.id)) continue;
      const files = asset.content?.files ?? [];
      const image =
        files
          .map((file) => normalizedHttpsUrl(file.cdn_uri ?? undefined))
          .find(Boolean) ??
        normalizedHttpsUrl(asset.content?.links?.image ?? undefined) ??
        files
          .map((file) => normalizedHttpsUrl(file.uri ?? undefined))
          .find(Boolean);
      const name =
        normalizedText(asset.content?.metadata?.name ?? undefined)?.slice(
          0,
          120,
        ) ?? null;
      const symbol =
        normalizedText(asset.content?.metadata?.symbol ?? undefined)?.slice(
          0,
          24,
        ) ?? null;
      if (image || name || symbol)
        logos.set(asset.id, { logoUrl: image ?? null, name, symbol });
    }
  } catch {
    console.warn("LAUNCH_LOGO_INDEX_UNAVAILABLE");
  }
  return logos;
}
