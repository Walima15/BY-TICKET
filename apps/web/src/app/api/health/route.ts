import { NextResponse } from "next/server";
import { publicEnv } from "@/lib/env";
import { serverEnv } from "@/lib/env.server";
import { contractsConfigured, stellarConfig } from "@/lib/stellar/config";
import { getRpc } from "@/lib/stellar/rpc";
import { supabaseConfigured } from "@/lib/supabase/client";
import { clientIp, rateLimit } from "@/lib/security/rate-limit";

/** Liveness + configuration check. Reports which integrations are configured, never their values. */
export async function GET(request: Request) {
  const limit = rateLimit(`health:${clientIp(request.headers)}`, 30, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Too many requests" } },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limit.resetAt - Date.now()) / 1000)) } },
    );
  }

  let rpcStatus: { url: string; reachable: boolean; latestLedger?: number } = {
    url: stellarConfig.rpcUrl,
    reachable: false,
  };
  try {
    const ledger = await Promise.race([
      getRpc().getLatestLedger(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 4_000)),
    ]);
    rpcStatus = { ...rpcStatus, reachable: true, latestLedger: ledger.sequence };
  } catch {
    // Unreachable RPC is reported, not thrown: health must still answer offline.
  }

  return NextResponse.json({
    status: "ok",
    app: publicEnv.NEXT_PUBLIC_APP_NAME,
    network: stellarConfig.network,
    rpc: rpcStatus,
    configured: {
      supabase: supabaseConfigured && Boolean(serverEnv.SUPABASE_SECRET_KEY),
      contracts: contractsConfigured,
      platformAccount: Boolean(serverEnv.STELLAR_PLATFORM_SECRET),
      qrSigning: Boolean(serverEnv.QR_CREDENTIAL_SIGNING_KEY && publicEnv.NEXT_PUBLIC_QR_CREDENTIAL_PUBLIC_KEY),
      custodialKeys: Boolean(serverEnv.CUSTODIAL_KEY_ENCRYPTION_KEY),
      paymentRamp: serverEnv.PAYMENT_RAMP_PROVIDER,
    },
  });
}
