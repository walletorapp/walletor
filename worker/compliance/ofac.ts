import { sha256 } from "@noble/hashes/sha2";
import { SaxesParser } from "saxes";
import { z } from "zod";

import { isSolanaAddress } from "../lib/solana";

export const OFAC_SOURCE_URL =
  "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML";
const OFAC_NAMESPACE =
  "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/XML";
const MAX_SOURCE_BYTES = 60_000_000;
export const MAX_SOURCE_AGE_MS = 24 * 60 * 60_000;
export const POLICY_VERSION = "ofac-explicit-sol-v1";

export const OfacSnapshotSchema = z.object({
  source: z.literal(OFAC_SOURCE_URL),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  fetchedAt: z.iso.datetime(),
  publishedDate: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/),
  recordCount: z.number().int().min(1000),
  digitalAddressCount: z.number().int().positive(),
  entries: z
    .array(
      z.object({
        address: z.string().refine(isSolanaAddress),
        entityId: z.string().regex(/^\d+$/),
      }),
    )
    .max(10_000),
});
export type OfacSnapshot = z.infer<typeof OfacSnapshotSchema>;

// Stream the full official XML rather than loading a large document tree.
// Only explicitly SOL-labelled identifiers are indexed. No fuzzy addresses.
export async function parseOfacSource(
  body: ReadableStream<Uint8Array>,
  fetchedAt: Date,
): Promise<OfacSnapshot> {
  const parser = new SaxesParser({ xmlns: true });
  const path: string[] = [];
  const entries: OfacSnapshot["entries"] = [];
  let text = "";
  let entityId = "";
  let idType = "";
  let idNumber = "";
  let publishedDate = "";
  let expectedRecords = "";
  let records = 0;
  let digitalAddresses = 0;
  const structure = { sawRoot: false };
  parser.on("doctype", () => {
    throw new Error("OFAC XML must not contain a document type.");
  });
  parser.on("opentag", (tag) => {
    if (tag.uri !== OFAC_NAMESPACE)
      throw new Error("Unexpected OFAC namespace.");
    path.push(tag.local);
    if (path.length === 1) {
      if (tag.local !== "sdnList") throw new Error("Unexpected OFAC root.");
      structure.sawRoot = true;
    }
    if (path.length > 12) throw new Error("OFAC XML nesting exceeds limits.");
    text = "";
    if (path.join("/") === "sdnList/sdnEntry") entityId = "";
    if (path.join("/") === "sdnList/sdnEntry/idList/id") {
      idType = "";
      idNumber = "";
    }
  });
  const append = (value: string) => {
    text += value;
    if (text.length > 200_000) throw new Error("OFAC field exceeds limits.");
  };
  parser.on("text", append);
  parser.on("cdata", append);
  parser.on("closetag", () => {
    const field = path.join("/");
    const value = text.trim();
    if (field === "sdnList/publshInformation/Publish_Date")
      publishedDate = value;
    if (field === "sdnList/publshInformation/Record_Count")
      expectedRecords = value;
    if (field === "sdnList/sdnEntry/uid") entityId = value;
    if (field === "sdnList/sdnEntry/idList/id/idType") idType = value;
    if (field === "sdnList/sdnEntry/idList/id/idNumber") idNumber = value;
    if (field === "sdnList/sdnEntry/idList/id") {
      if (idType.startsWith("Digital Currency Address")) digitalAddresses++;
      if (idType === "Digital Currency Address - SOL") {
        if (!isSolanaAddress(idNumber) || !/^\d+$/.test(entityId)) {
          throw new Error("Invalid OFAC Solana identifier.");
        }
        entries.push({ address: idNumber, entityId });
      }
    }
    if (field === "sdnList/sdnEntry") records++;
    path.pop();
    text = "";
  });
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const hash = sha256.create();
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_SOURCE_BYTES)
        throw new Error("OFAC source exceeds limits.");
      hash.update(chunk.value);
      parser.write(decoder.decode(chunk.value, { stream: true }));
    }
    parser.write(decoder.decode()).close();
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (
    !structure.sawRoot ||
    !/^\d+$/.test(expectedRecords) ||
    records !== Number(expectedRecords)
  ) {
    throw new Error("OFAC record count does not match its publication.");
  }
  const snapshot = OfacSnapshotSchema.parse({
    source: OFAC_SOURCE_URL,
    hash: Array.from(hash.digest(), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join(""),
    fetchedAt: fetchedAt.toISOString(),
    publishedDate,
    recordCount: records,
    digitalAddressCount: digitalAddresses,
    entries,
  });
  const publicationTime = Date.parse(
    `${publishedDate.slice(6)}-${publishedDate.slice(0, 2)}-${publishedDate.slice(3, 5)}T00:00:00Z`,
  );
  if (
    !Number.isFinite(publicationTime) ||
    publicationTime > fetchedAt.getTime() + 24 * 60 * 60_000
  ) {
    throw new Error("OFAC publication date is invalid.");
  }
  return snapshot;
}

export function snapshotIsCurrent(snapshot: OfacSnapshot, now: Date): boolean {
  const age = now.getTime() - Date.parse(snapshot.fetchedAt);
  return age >= 0 && age < MAX_SOURCE_AGE_MS;
}

export async function fetchOfacSnapshot(
  fetcher: typeof fetch = fetch,
  now = new Date(),
): Promise<OfacSnapshot> {
  const signal = AbortSignal.timeout(45_000);
  let url = OFAC_SOURCE_URL;
  for (let hop = 0; hop < 3; hop++) {
    const response = await fetcher(url, {
      signal,
      redirect: "manual",
      headers: {
        Accept: "application/xml, text/xml",
        "Cache-Control": "no-cache",
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("OFAC redirect is missing its location.");
      const target = new URL(location, url);
      // SLS publishes through this US-government S3 bucket. Never accept an
      // arbitrary redirect or log its temporary signed download query string.
      if (
        target.protocol !== "https:" ||
        target.username ||
        target.password ||
        target.port ||
        ![
          "sanctionslistservice.ofac.treas.gov",
          "wc2h-sls-prod-public-published.s3.us-gov-west-1.amazonaws.com",
        ].includes(target.hostname)
      )
        throw new Error("OFAC redirected to an untrusted host.");
      url = target.href;
      continue;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error(
        `OFAC source unavailable (HTTP ${String(response.status)}).`,
      );
    }
    return parseOfacSource(response.body, now);
  }
  throw new Error("Too many OFAC source redirects.");
}
