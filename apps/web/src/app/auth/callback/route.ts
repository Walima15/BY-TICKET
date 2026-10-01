import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";
import { afterSignIn } from "@/lib/auth/bootstrap";
import { safeNextPath } from "@/lib/auth/redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Magic-link landing (PKCE): exchange `?code=` for a session cookie. */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = safeNextPath(request.nextUrl.searchParams.get("next"), "/tickets");
  // Redirect to the configured app URL, never to the request's Host header.
  const base = publicEnv.NEXT_PUBLIC_APP_URL;

  if (code) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user) {
      await afterSignIn(data.user);
      return NextResponse.redirect(new URL(next, base));
    }
  }
  return NextResponse.redirect(new URL(`/login?error=link&next=${encodeURIComponent(next)}`, base));
}
