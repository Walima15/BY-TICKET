import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { supabaseConfigured } from "@/lib/supabase/client";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { AppRole } from "./roles";

export interface Viewer {
  id: string;
  email: string | null;
  displayName: string | null;
  roles: AppRole[];
}

/**
 * The signed-in user for this request, or null. Verified against Supabase Auth
 * (`getClaims` checks the JWT signature), never read from an unverified cookie.
 * Cached per request so layouts and pages can both call it.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  // Always per-request, even when Supabase isn't configured, so protected pages are never prerendered.
  await connection();
  if (!supabaseConfigured) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (error || !sub) return null;

  const [{ data: profile }, { data: roles }] = await Promise.all([
    supabase.from("profiles").select("email, display_name").eq("id", sub).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", sub),
  ]);
  return {
    id: sub,
    email: profile?.email ?? (typeof data.claims.email === "string" ? data.claims.email : null),
    displayName: profile?.display_name ?? null,
    roles: (roles ?? []).map((r) => r.role),
  };
});

export function hasRole(viewer: Viewer | null, role: AppRole): boolean {
  return Boolean(viewer?.roles.includes(role));
}

/** Use at the top of protected pages / actions. Redirects to /login if signed out. */
export async function requireViewer(next: string): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(next)}`);
  return viewer;
}

/** Like requireViewer, but also requires one of `roles`; otherwise renders the 404 page. */
export async function requireRole(roles: AppRole | AppRole[], next: string): Promise<Viewer> {
  const viewer = await requireViewer(next);
  const wanted = Array.isArray(roles) ? roles : [roles];
  if (!wanted.some((r) => viewer.roles.includes(r))) notFound();
  return viewer;
}
