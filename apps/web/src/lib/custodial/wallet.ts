import "server-only";
import { Keypair } from "@stellar/stellar-sdk";
import { serverEnv } from "@/lib/env.server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { sealSecret, toPgBytea } from "./crypto";

/**
 * Give an email user a platform-managed Stellar keypair. Only the public key is ever
 * returned; the secret is encrypted before it leaves this function and is not logged.
 * On-chain activation (account creation + USDC trustline, sponsored by the platform
 * account) happens in Phase 4 and sets `wallets.activated_at`.
 */
export async function ensureCustodialWallet(userId: string): Promise<string | null> {
  const encryptionKey = serverEnv.CUSTODIAL_KEY_ENCRYPTION_KEY;
  if (!encryptionKey) {
    console.warn("CUSTODIAL_KEY_ENCRYPTION_KEY is not set: skipping custodial wallet provisioning");
    return null;
  }
  const admin = createSupabaseAdminClient();

  const { data: existing, error: readError } = await admin
    .from("wallets")
    .select("public_key")
    .eq("user_id", userId)
    .eq("kind", "custodial")
    .maybeSingle();
  if (readError) throw readError;
  if (existing) return existing.public_key;

  const keypair = Keypair.random();
  const publicKey = keypair.publicKey();
  const sealed = sealSecret(keypair.secret(), publicKey, encryptionKey);

  const { count } = await admin.from("wallets").select("id", { count: "exact", head: true }).eq("user_id", userId);
  const { data: wallet, error: insertError } = await admin
    .from("wallets")
    .insert({ user_id: userId, kind: "custodial", public_key: publicKey, is_primary: !count })
    .select("id")
    .single();
  if (insertError) {
    // 23505: a concurrent sign-in created it first (unique index on one custodial wallet per user).
    if (insertError.code === "23505") return ensureCustodialWallet(userId);
    throw insertError;
  }

  const { error: keyError } = await admin.from("custodial_keys").insert({
    wallet_id: wallet.id,
    ciphertext: toPgBytea(sealed.ciphertext),
    iv: toPgBytea(sealed.iv),
    auth_tag: toPgBytea(sealed.authTag),
    key_version: sealed.keyVersion,
  });
  if (keyError) {
    await admin.from("wallets").delete().eq("id", wallet.id);
    throw keyError;
  }
  return publicKey;
}
