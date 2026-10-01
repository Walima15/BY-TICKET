import { publicEnv } from "@/lib/env";

/** USDC and BY Points use 7 decimals on Stellar; amounts are integer "units" (bigint). */
export const TOKEN_DECIMALS = 7;
const UNIT = 10n ** BigInt(TOKEN_DECIMALS);

/** Parse a decimal string ("12.50") into integer token units without float rounding. */
export function toUnits(amount: string): bigint {
  const m = amount.trim().match(/^(\d+)(?:\.(\d{0,7}))?$/);
  if (!m) throw new Error(`Invalid amount: ${amount}`);
  const [, whole, frac = ""] = m;
  return BigInt(whole) * UNIT + BigInt(frac.padEnd(TOKEN_DECIMALS, "0"));
}

/** Format integer token units as a decimal string with `dp` decimals (truncating). */
export function fromUnits(units: bigint, dp = 2): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / UNIT;
  const frac = (abs % UNIT).toString().padStart(TOKEN_DECIMALS, "0").slice(0, dp);
  return `${negative ? "-" : ""}${whole}${dp > 0 ? `.${frac}` : ""}`;
}

/** Display-only ZMW conversion. Settlement is always in USDC/XLM on-chain. */
export function usdcUnitsToZmw(units: bigint, rate = publicEnv.NEXT_PUBLIC_ZMW_PER_USDC): number {
  return (Number(units) / Number(UNIT)) * rate;
}

const zmw = new Intl.NumberFormat("en-ZM", { style: "currency", currency: "ZMW", maximumFractionDigits: 0 });

export function formatPrice(units: bigint): { usdc: string; zmw: string } {
  return { usdc: `${fromUnits(units)} USDC`, zmw: zmw.format(usdcUnitsToZmw(units)) };
}
