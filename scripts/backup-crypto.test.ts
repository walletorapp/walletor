// @vitest-environment node
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { encryptBackup, decryptBackup, digest } from "./backup-crypto.mjs";

describe("encrypted backups", () => {
  it("roundtrips SQL and rejects ciphertext tampering even with a replaced checksum", async () => {
    const dir = await mkdtemp(join(tmpdir(), "walletor-backup-test-"));
    try {
      const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const source = join(dir, "source.sql"),
        encrypted = join(dir, "backup.enc");
      await writeFile(
        source,
        "CREATE TABLE ledger (amount TEXT);\nINSERT INTO ledger VALUES ('9007199254740993');",
      );
      await encryptBackup(source, encrypted, keys.publicKey);
      await decryptBackup(
        encrypted,
        join(dir, "restored.sql"),
        keys.privateKey,
      );
      expect(await readFile(join(dir, "restored.sql"), "utf8")).toBe(
        await readFile(source, "utf8"),
      );
      const data = await readFile(encrypted);
      data[0] = (data[0] ?? 0) ^ 1;
      await writeFile(encrypted, data);
      await expect(
        decryptBackup(encrypted, join(dir, "bad.sql"), keys.privateKey),
      ).rejects.toThrow("checksum");
      const manifest = JSON.parse(await readFile(encrypted + ".json", "utf8"));
      manifest.encryptedSha256 = await digest(encrypted);
      await writeFile(encrypted + ".json", JSON.stringify(manifest));
      await expect(
        decryptBackup(encrypted, join(dir, "bad-auth.sql"), keys.privateKey),
      ).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
