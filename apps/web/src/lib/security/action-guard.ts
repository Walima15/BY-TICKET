import "server-only";
import { headers } from "next/headers";
import { clientIp, rateLimit } from "./rate-limit";

/**
 * Rate-limit a Server Action. Returns an error message when the caller is over the limit.
 * `scope` separates buckets per action; `subject` (e.g. email or user id) adds a second,
 * per-identity bucket so rotating IPs doesn't help against a single account.
 */
export async function limitAction(
  scope: string,
  { limit, windowMs, subject }: { limit: number; windowMs: number; subject?: string },
): Promise<string | null> {
  const ip = clientIp(await headers());
  const checks = [rateLimit(`${scope}:ip:${ip}`, limit * 3, windowMs)];
  if (subject) checks.push(rateLimit(`${scope}:sub:${subject}`, limit, windowMs));
  const blocked = checks.find((c) => !c.ok);
  if (!blocked) return null;
  const minutes = Math.max(1, Math.ceil((blocked.resetAt - Date.now()) / 60_000));
  return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}
