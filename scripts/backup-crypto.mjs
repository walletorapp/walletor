import {
  createCipheriv,
  createDecipheriv,
  publicEncrypt,
  privateDecrypt,
  randomBytes,
  createHash,
} from "node:crypto";
import { Buffer } from "node:buffer";
import { createReadStream, createWriteStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createGzip, createGunzip } from "node:zlib";

export async function digest(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
export async function encryptBackup(source, target, publicKey) {
  const key = randomBytes(32),
    iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encryptedKey = publicEncrypt(
    { key: publicKey, oaepHash: "sha256" },
    key,
  );
  try {
    await pipeline(
      createReadStream(source),
      createGzip(),
      cipher,
      createWriteStream(target, { flags: "wx", mode: 0o600 }),
    );
    const manifest = {
      format: "walletor-backup-v1",
      cipher: "AES-256-GCM",
      keyWrapping: "RSA-OAEP-SHA256",
      iv: iv.toString("base64"),
      encryptedKey: encryptedKey.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      encryptedSha256: await digest(target),
      sourceSha256: await digest(source),
    };
    await writeFile(`${target}.json`, JSON.stringify(manifest, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
    return manifest;
  } finally {
    key.fill(0);
  }
}
export async function decryptBackup(source, target, privateKey) {
  const manifest = JSON.parse(await readFile(`${source}.json`, "utf8"));
  if (
    manifest.format !== "walletor-backup-v1" ||
    manifest.cipher !== "AES-256-GCM" ||
    manifest.keyWrapping !== "RSA-OAEP-SHA256"
  )
    throw new Error("Unsupported backup format");
  if ((await digest(source)) !== manifest.encryptedSha256)
    throw new Error("Backup checksum mismatch");
  const key = privateDecrypt(
    { key: privateKey, oaepHash: "sha256" },
    Buffer.from(manifest.encryptedKey, "base64"),
  );
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(manifest.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(manifest.tag, "base64"));
    await pipeline(
      createReadStream(source),
      decipher,
      createGunzip(),
      createWriteStream(target, { flags: "wx", mode: 0o600 }),
    );
    if ((await digest(target)) !== manifest.sourceSha256)
      throw new Error("Restored backup checksum mismatch");
  } finally {
    key.fill(0);
  }
}
