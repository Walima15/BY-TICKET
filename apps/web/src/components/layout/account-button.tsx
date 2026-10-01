"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CircleUserRound } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { createSupabaseBrowserClient, supabaseConfigured } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Client-side so pages stay statically renderable; reads the session from the
 * cookie only to choose the label. Anything sensitive is verified on the server.
 */
export function AccountButton() {
  const [signedIn, setSignedIn] = useState<boolean | null>(supabaseConfigured ? null : false);

  useEffect(() => {
    if (!supabaseConfigured) return;
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setSignedIn(Boolean(session)));
    return () => data.subscription.unsubscribe();
  }, []);

  if (signedIn === null) return <span className="size-8" aria-hidden />;
  return signedIn ? (
    <Link href="/account" aria-label="Your account" className={buttonVariants({ variant: "ghost", size: "icon" })}>
      <CircleUserRound className="size-5" aria-hidden />
    </Link>
  ) : (
    <Link href="/login" className={cn(buttonVariants({ size: "sm" }), "px-3 font-semibold")}>
      Sign in
    </Link>
  );
}
