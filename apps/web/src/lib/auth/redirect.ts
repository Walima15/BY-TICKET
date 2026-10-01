/**
 * Sanitise a post-login `next` target so it can only point inside this app
 * (blocks open redirects like `//evil.com`, `/\evil.com` or `https://evil.com`).
 */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next || next.length > 512) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\\]/.test(next)) return fallback;
  try {
    const url = new URL(next, "http://local.invalid");
    if (url.origin !== "http://local.invalid") return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}

/** Routes that need a signed-in user. Role checks happen in each page on the server. */
export const PROTECTED_PREFIXES = ["/tickets", "/rewards", "/account", "/organizer", "/scan", "/admin"] as const;

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
