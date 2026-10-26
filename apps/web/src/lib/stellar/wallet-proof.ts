import { createHash } from "node:crypto";
import { Keypair, StrKey } from "@stellar/stellar-sdk";

export const WALLET_CHALLENGE_TTL_MS = 5 * 60_000;

export interface WalletChallenge {
  domain: string;
  publicKey: string;
  networkPassphrase: string;
  nonce: string;
  expiresAt: Date;
}

/**
 * The exact text the wallet signs. Binding the domain, network and expiry means a signature
 * collected by another site, for another network, or after expiry never links a wallet here.
 */
export function walletChallengeMessage(c: WalletChallenge): string {
  return [
    "BY Tickets: link this Stellar wallet to your account.",
    "Only sign this on the BY Tickets website. It does not move any funds.",
    "",
    `Domain: ${c.domain}`,
    `Wallet: ${c.publicKey}`,
    `Network: ${c.networkPassphrase}`,
    `Nonce: ${c.nonce}`,
    `Expires: ${c.expiresAt.toISOString()}`,
  ].join("\n");
}

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest();

/** SEP-53 signed-message hash: SHA-256("Stellar Signed Message:\n" + message). */
export function sep53Hash(message: string): Buffer {
  return sha256(Buffer.concat([Buffer.from("Stellar Signed Message:\n", "utf8"), Buffer.from(message, "utf8")]));
}

/** Decode a signature sent as base64 or hex; null unless it is a 64-byte ed25519 signature. */
export function decodeSignature(signature: string): Buffer | null {
  const s = signature.trim();
  const raw = /^[0-9a-f]{128}$/i.test(s) ? Buffer.from(s, "hex") : Buffer.from(s, "base64");
  return raw.length === 64 ? raw : null;
}

/**
 * Verify a wallet signature over `message`. Current Freighter signs the SEP-53 hash; older
 * releases signed SHA-256(message). Both cover the full challenge text, so either proves control.
 */
export function verifyWalletSignature(publicKey: string, message: string, signature: string): boolean {
  if (!StrKey.isValidEd25519PublicKey(publicKey)) return false;
  const sig = decodeSignature(signature);
  if (!sig) return false;
  const keypair = Keypair.fromPublicKey(publicKey);
  try {
    return (
      keypair.verify(sep53Hash(message), sig) || keypair.verify(sha256(Buffer.from(message, "utf8")), sig)
    );
  } catch {
    return false;
  }
}
