import { describe, expect, it } from "vitest";
import { buildHandleCandidate, decodeJwtPayload, normalizeUserId } from "./authIdentity";

function buildToken(payload) {
  const encodedPayload = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

  return `header.${encodedPayload}.signature`;
}

describe("authIdentity helpers", () => {
  it("decodes JWT payload from a token", () => {
    const token = buildToken({ uid: 42, handle: "@pulse" });
    expect(decodeJwtPayload(token)).toEqual({ uid: 42, handle: "@pulse" });
  });

  it("normalizes numeric user ids", () => {
    expect(normalizeUserId("00042")).toBe("42");
    expect(normalizeUserId("abc-42")).toBe("abc-42");
    expect(normalizeUserId("   ")).toBeNull();
  });

  it("builds sanitized handles", () => {
    expect(buildHandleCandidate("  @@Noah Park! ")).toBe("@noahpark");
    expect(buildHandleCandidate("", "Avery_123")).toBe("@avery_123");
  });
});
