import { StrKey } from "@stellar/stellar-sdk";
import { z } from "zod";

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalText = (max: number) => z.preprocess(blankToUndefined, z.string().trim().max(max).optional());

export const emailSchema = z
  .string("Enter a valid email address")
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address").max(254));

// Supabase email OTPs are 6–10 digits depending on project settings.
export const otpSchema = z
  .string()
  .trim()
  .regex(/^\d{6,10}$/, "Enter the code from your email");

export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ""))
  .pipe(z.string().regex(/^\+?[0-9]{7,15}$/, "Enter a phone number like +260971234567"));

export const stellarAccountSchema = z
  .string()
  .trim()
  .refine((v) => StrKey.isValidEd25519PublicKey(v), "Enter a valid Stellar public key (starts with G)");

export const profileSchema = z.object({
  display_name: z.string().trim().min(1, "Enter your name").max(80),
  phone: z.preprocess(blankToUndefined, phoneSchema.optional()),
  city: optionalText(80),
});

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

export const organizerApplicationSchema = z
  .object({
    name: z.string().trim().min(2, "Enter your organizer or brand name").max(80),
    slug: z.preprocess(blankToUndefined, z.string().trim().toLowerCase().optional()),
    bio: optionalText(2000),
    city: z.string().trim().min(2, "Enter your city").max(80),
    contact_email: emailSchema,
    contact_phone: phoneSchema,
    payout_public_key: z.preprocess(blankToUndefined, stellarAccountSchema.optional()),
  })
  .transform((v) => ({ ...v, slug: slugify(v.slug ?? v.name) }))
  .refine((v) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v.slug) && v.slug.length >= 2, {
    path: ["slug"],
    message: "Use letters and numbers for your page address",
  });

export type FieldErrors = Partial<Record<string, string>>;

/** First message per field, for showing next to form inputs. */
export function fieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}
