import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { emailSchema, organizerApplicationSchema, otpSchema, profileSchema, slugify } from "./account";

describe("account validation", () => {
  it("normalises email", () => {
    expect(emailSchema.parse("  Alice@Example.COM ")).toBe("alice@example.com");
    expect(emailSchema.safeParse("not-an-email").success).toBe(false);
  });

  it("accepts 6–10 digit codes only", () => {
    expect(otpSchema.parse(" 123456 ")).toBe("123456");
    expect(otpSchema.safeParse("12345").success).toBe(false);
    expect(otpSchema.safeParse("12345a").success).toBe(false);
  });

  it("cleans phone numbers and treats blanks as empty", () => {
    const p = profileSchema.parse({ display_name: " Alice ", phone: "+260 (97) 123-4567", city: "" });
    expect(p).toEqual({ display_name: "Alice", phone: "+260971234567", city: undefined });
    expect(profileSchema.safeParse({ display_name: "A", phone: "call me" }).success).toBe(false);
  });

  it("slugifies names", () => {
    expect(slugify("Mwanza Sounds & Co.")).toBe("mwanza-sounds-co");
    expect(slugify("Café Ndola")).toBe("cafe-ndola");
  });

  const base = {
    name: "Lusaka Live",
    city: "Lusaka",
    contact_email: "hello@example.com",
    contact_phone: "+260971234567",
  };

  it("derives the organizer slug from the name", () => {
    expect(organizerApplicationSchema.parse(base).slug).toBe("lusaka-live");
    expect(organizerApplicationSchema.parse({ ...base, slug: "LL Events!" }).slug).toBe("ll-events");
  });

  it("validates the payout key checksum", () => {
    const good = Keypair.random().publicKey();
    expect(organizerApplicationSchema.parse({ ...base, payout_public_key: good }).payout_public_key).toBe(good);
    const corrupted = good.slice(0, -1) + (good.endsWith("A") ? "B" : "A");
    expect(organizerApplicationSchema.safeParse({ ...base, payout_public_key: corrupted }).success).toBe(false);
    expect(organizerApplicationSchema.parse({ ...base, payout_public_key: "" }).payout_public_key).toBeUndefined();
  });
});
