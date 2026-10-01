import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";
import { afterSignIn } from "@/lib/auth/bootstrap";
import { safeNextPath } from "@/lib/auth/redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const OTP_TYPES = new Set<EmailOtpType>(["email", "magiclink", "signup", "invite", "recovery", "email_change"]);

/**
 * Email-template link target: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`.
 * Unlike the PKCE callback this works when the email is opened on another device or browser.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;
  const next = safeNextPath(params.get("next"), "/tickets");
  const base = publicEnv.NEXT_PUBLIC_APP_URL;

  if (tokenHash && type && OTP_TYPES.has(type)) {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error && data.user) {
      await afterSignIn(data.user);
      return NextResponse.redirect(new URL(next, base));
    }
  }
  return NextResponse.redirect(new URL(`/login?error=link&next=${encodeURIComponent(next)}`, base));
}
