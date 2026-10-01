import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { serverEnv } from "@/lib/env.server";
import { supabaseConfigured } from "./client";
import type { Database } from "./database.types";

/** Server Supabase client bound to the request's auth cookies (RLS applies). */
export async function createSupabaseServerClient() {
  if (!supabaseConfigured) {
    throw new Error("Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  }
  const cookieStore = await cookies();
  return createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL!,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component, where cookies are read-only. The proxy refreshes sessions.
          }
        },
      },
    },
  );
}

export const supabaseAdminConfigured = Boolean(publicEnv.NEXT_PUBLIC_SUPABASE_URL && serverEnv.SUPABASE_SECRET_KEY);

/**
 * Privileged client that BYPASSES RLS. Only for trusted server jobs
 * (chain indexer, admin bootstrap, custodial wallets). Never pass user input into it unchecked.
 */
export function createSupabaseAdminClient() {
  if (!supabaseAdminConfigured) {
    throw new Error("Supabase admin client requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY");
  }
  return createClient<Database>(publicEnv.NEXT_PUBLIC_SUPABASE_URL!, serverEnv.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
