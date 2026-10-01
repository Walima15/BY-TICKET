import { z } from "zod";

/**
 * Client-safe environment. Every NEXT_PUBLIC_* var must be referenced literally
 * (`process.env.NEXT_PUBLIC_X`) so Next.js can inline it into the browser bundle.
 * Server-only secrets live in `env.server.ts`.
 */

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema.optional());

const contractId = z.string().regex(/^C[A-Z2-7]{55}$/, "must be a Soroban contract ID (C...)");
const accountId = z.string().regex(/^G[A-Z2-7]{55}$/, "must be a Stellar account ID (G...)");

const publicSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
  NEXT_PUBLIC_APP_NAME: z.string().default("BY Tickets"),

  NEXT_PUBLIC_SUPABASE_URL: optional(z.url()),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: optional(z.string().min(20)),

  NEXT_PUBLIC_STELLAR_NETWORK: z.enum(["testnet", "public"]).default("testnet"),
  NEXT_PUBLIC_STELLAR_RPC_URL: z.url().default("https://soroban-testnet.stellar.org"),
  NEXT_PUBLIC_STELLAR_HORIZON_URL: z.url().default("https://horizon-testnet.stellar.org"),
  NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE: z.string().default("Test SDF Network ; September 2015"),

  NEXT_PUBLIC_EVENT_TICKET_CONTRACT_ID: optional(contractId),
  NEXT_PUBLIC_REWARDS_CONTRACT_ID: optional(contractId),
  NEXT_PUBLIC_BADGE_CONTRACT_ID: optional(contractId),

  NEXT_PUBLIC_USDC_ASSET_CODE: z.string().default("USDC"),
  NEXT_PUBLIC_USDC_ISSUER: optional(accountId),
  NEXT_PUBLIC_USDC_CONTRACT_ID: optional(contractId),
  NEXT_PUBLIC_STELLAR_PLATFORM_PUBLIC_KEY: optional(accountId),
  NEXT_PUBLIC_STELLAR_ADMIN_PUBLIC_KEY: optional(accountId),

  NEXT_PUBLIC_QR_CREDENTIAL_PUBLIC_KEY: optional(z.string().min(40)),
  NEXT_PUBLIC_QR_ROTATION_SECONDS: z.coerce.number().int().min(5).max(120).default(20),

  NEXT_PUBLIC_ZMW_PER_USDC: z.coerce.number().positive().default(26.5),
});

export type PublicEnv = z.infer<typeof publicSchema>;

function parsePublicEnv(): PublicEnv {
  const result = publicSchema.safeParse({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_STELLAR_NETWORK: process.env.NEXT_PUBLIC_STELLAR_NETWORK,
    NEXT_PUBLIC_STELLAR_RPC_URL: process.env.NEXT_PUBLIC_STELLAR_RPC_URL,
    NEXT_PUBLIC_STELLAR_HORIZON_URL: process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL,
    NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE: process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE,
    NEXT_PUBLIC_EVENT_TICKET_CONTRACT_ID: process.env.NEXT_PUBLIC_EVENT_TICKET_CONTRACT_ID,
    NEXT_PUBLIC_REWARDS_CONTRACT_ID: process.env.NEXT_PUBLIC_REWARDS_CONTRACT_ID,
    NEXT_PUBLIC_BADGE_CONTRACT_ID: process.env.NEXT_PUBLIC_BADGE_CONTRACT_ID,
    NEXT_PUBLIC_USDC_ASSET_CODE: process.env.NEXT_PUBLIC_USDC_ASSET_CODE,
    NEXT_PUBLIC_USDC_ISSUER: process.env.NEXT_PUBLIC_USDC_ISSUER,
    NEXT_PUBLIC_USDC_CONTRACT_ID: process.env.NEXT_PUBLIC_USDC_CONTRACT_ID,
    NEXT_PUBLIC_STELLAR_PLATFORM_PUBLIC_KEY: process.env.NEXT_PUBLIC_STELLAR_PLATFORM_PUBLIC_KEY,
    NEXT_PUBLIC_STELLAR_ADMIN_PUBLIC_KEY: process.env.NEXT_PUBLIC_STELLAR_ADMIN_PUBLIC_KEY,
    NEXT_PUBLIC_QR_CREDENTIAL_PUBLIC_KEY: process.env.NEXT_PUBLIC_QR_CREDENTIAL_PUBLIC_KEY,
    NEXT_PUBLIC_QR_ROTATION_SECONDS: process.env.NEXT_PUBLIC_QR_ROTATION_SECONDS,
    NEXT_PUBLIC_ZMW_PER_USDC: process.env.NEXT_PUBLIC_ZMW_PER_USDC,
  });
  if (!result.success) {
    throw new Error(`Invalid public environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export const publicEnv = parsePublicEnv();
