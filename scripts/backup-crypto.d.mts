import type { KeyObject } from "node:crypto";
export interface BackupManifest {
  format: string;
  cipher: string;
  keyWrapping: string;
  iv: string;
  encryptedKey: string;
  tag: string;
  encryptedSha256: string;
  sourceSha256: string;
}
export function digest(path: string): Promise<string>;
export function encryptBackup(
  source: string,
  target: string,
  publicKey: string | KeyObject,
): Promise<BackupManifest>;
export function decryptBackup(
  source: string,
  target: string,
  privateKey: string | KeyObject,
): Promise<void>;
