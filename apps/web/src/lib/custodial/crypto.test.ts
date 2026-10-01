import { randomBytes } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { fromPgBytea, openSecret, sealSecret, toPgBytea } from "./crypto";

const key = randomBytes(32).toString("base64");

describe("custodial secret encryption", () => {
  const kp = Keypair.random();

  it("round-trips a Stellar secret", () => {
    const sealed = sealSecret(kp.secret(), kp.publicKey(), key);
    expect(sealed.ciphertext.toString("utf8")).not.toContain(kp.secret());
    expect(openSecret(sealed, kp.publicKey(), key)).toBe(kp.secret());
  });

  it("uses a fresh IV every time", () => {
    const a = sealSecret(kp.secret(), kp.publicKey(), key);
    const b = sealSecret(kp.secret(), kp.publicKey(), key);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it("rejects a ciphertext moved onto another wallet", () => {
    const sealed = sealSecret(kp.secret(), kp.publicKey(), key);
    expect(() => openSecret(sealed, Keypair.random().publicKey(), key)).toThrow();
  });

  it("rejects the wrong key and tampered data", () => {
    const sealed = sealSecret(kp.secret(), kp.publicKey(), key);
    expect(() => openSecret(sealed, kp.publicKey(), randomBytes(32).toString("base64"))).toThrow();
    const tampered = Buffer.from(sealed.ciphertext);
    tampered[0] ^= 1;
    expect(() => openSecret({ ...sealed, ciphertext: tampered }, kp.publicKey(), key)).toThrow();
  });

  it("refuses keys that aren't 32 bytes", () => {
    expect(() => sealSecret("x", kp.publicKey(), randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
  });

  it("encodes bytea the way PostgREST expects", () => {
    const buf = randomBytes(12);
    expect(toPgBytea(buf)).toMatch(/^\\x[0-9a-f]{24}$/);
    expect(fromPgBytea(toPgBytea(buf)).equals(buf)).toBe(true);
  });
});
