import { describe, expect, it } from "vitest";
import { isProtectedPath, safeNextPath } from "./redirect";

describe("safeNextPath", () => {
  it.each([
    ["/tickets", "/tickets"],
    ["/events/abc?tier=vip#buy", "/events/abc?tier=vip#buy"],
    ["/organizer/../admin", "/admin"],
  ])("keeps in-app path %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/%0d%0aSet-Cookie:x=1".replace("%0d%0a", "\r\n"),
    "javascript:alert(1)",
    "tickets",
    "",
    null,
    undefined,
    `/${"a".repeat(600)}`,
  ])("falls back for unsafe target %s", (input) => {
    expect(safeNextPath(input, "/home")).toBe("/home");
  });
});

describe("isProtectedPath", () => {
  it("matches protected sections and their children only", () => {
    expect(isProtectedPath("/tickets")).toBe(true);
    expect(isProtectedPath("/admin/fees")).toBe(true);
    expect(isProtectedPath("/events")).toBe(false);
    expect(isProtectedPath("/ticketshop")).toBe(false);
    expect(isProtectedPath("/")).toBe(false);
  });
});
