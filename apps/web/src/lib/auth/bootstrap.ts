import "server-only";
import { serverEnv } from "@/lib/env.server";
import { ensureCustodialWallet } from "@/lib/custodial/wallet";
import { createSupabaseAdminClient, supabaseAdminConfigured } from "@/lib/supabase/server";

/**
 * Runs after every successful sign-in. Idempotent.
 *  - grants `admin` to addresses listed in ADMIN_EMAILS (bootstrap; manage roles in /admin afterwards)
 *  - provisions the user's custodial Stellar wallet
 * Failures are logged, never block the sign-in itself.
 */
export async function afterSignIn(user: { id: string; email?: string | null }) {
  if (!supabaseAdminConfigured) {
    console.warn("SUPABASE_SECRET_KEY is not set: skipping admin bootstrap and custodial wallet provisioning");
    return;
  }
  try {
    const email = user.email?.toLowerCase();
    if (email && serverEnv.ADMIN_EMAILS.includes(email)) {
      const admin = createSupabaseAdminClient();
      const { error } = await admin
        .from("user_roles")
        .upsert({ user_id: user.id, role: "admin" }, { onConflict: "user_id,role", ignoreDuplicates: true });
      if (error) throw error;
    }
    await ensureCustodialWallet(user.id);
  } catch (err) {
    console.error("post sign-in bootstrap failed", { userId: user.id, err });
  }
}
