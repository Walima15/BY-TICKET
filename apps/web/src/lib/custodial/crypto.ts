import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM envelope for custodial Stellar secrets (DECISIONS D-008).
 * The wallet's public key is bound in as associated data, so a ciphertext copied
 * onto another wallet row fails to decrypt instead of signing for the wrong account.
 */

export const CURRENT_KEY_VERSION = 1;

export interface SealedSecret {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyVersion: number;
}

function aad(publicKey: string) {
  return Buffer.from(`by-tickets:custodial:v1:${publicKey}`, "utf8");
}

function parseKey(keyB64: string): Buffer {
  const key = Buffer.from(keyB64, "base64");
  if (key.length !== 32) throw new Error("custodial encryption key must be 32 bytes");
  return key;
}

export function sealSecret(secret: string, publicKey: string, keyB64: string): SealedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", parseKey(keyB64), iv);
  cipher.setAAD(aad(publicKey));
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag(), keyVersion: CURRENT_KEY_VERSION };
}

export function openSecret(sealed: Omit<SealedSecret, "keyVersion">, publicKey: string, keyB64: string): string {
  const decipher = createDecipheriv("aes-256-gcm", parseKey(keyB64), sealed.iv);
  decipher.setAAD(aad(publicKey));
  decipher.setAuthTag(sealed.authTag);
  return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString("utf8");
}

/** PostgREST exchanges `bytea` as `\x`-prefixed hex strings. */
export const toPgBytea = (buf: Buffer) => `\\x${buf.toString("hex")}`;

export function fromPgBytea(value: string): Buffer {
  if (!value.startsWith("\\x")) throw new Error("expected hex-encoded bytea");
  return Buffer.from(value.slice(2), "hex");
}
