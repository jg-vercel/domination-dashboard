import { describe, expect, it } from "vitest";

import { AuthError } from "./errors";
import {
  APP_SESSION_COOKIE_TTL_SECONDS,
  createAppSessionPointer,
  createOAuthFlow,
  readAppSessionPointer,
  readOAuthFlow,
} from "./session";

const secret = "test-session-secret-that-is-longer-than-32-characters";

describe("sealed OAuth flow", () => {
  it("round-trips PKCE state without plaintext in the cookie", () => {
    const { flow, sealed } = createOAuthFlow(secret, 1_000);

    expect(sealed).not.toContain(flow.state);
    expect(sealed).not.toContain(flow.codeVerifier);
    expect(readOAuthFlow(sealed, secret, 1_001)).toEqual(flow);
  });

  it("rejects tampering and expiry", () => {
    const { sealed } = createOAuthFlow(secret, 1_000);
    const parts = sealed.split(".");
    const encrypted = parts[2]!;
    parts[2] = `${encrypted[0] === "A" ? "B" : "A"}${encrypted.slice(1)}`;
    const tampered = parts.join(".");

    expect(() => readOAuthFlow(tampered, secret, 1_001)).toThrowError(
      AuthError,
    );
    expect(() => readOAuthFlow(sealed, secret, 1_601)).toThrowError(
      expect.objectContaining({ code: "SESSION_EXPIRED" }),
    );
  });
});

describe("opaque app session cookie", () => {
  it("contains only a sealed random session pointer", () => {
    const sessionId = "opaque-session-id-that-is-longer-than-32-characters";
    const { pointer, sealed } = createAppSessionPointer(sessionId, secret, 2_000);

    expect(sealed).not.toContain(sessionId);
    expect(pointer.expiresAt).toBe(2_000 + APP_SESSION_COOKIE_TTL_SECONDS);
    expect(readAppSessionPointer(sealed, secret, 2_001)).toEqual(pointer);
  });

  it("rejects an expired pointer", () => {
    const { sealed } = createAppSessionPointer(
      "opaque-session-id-that-is-longer-than-32-characters",
      secret,
      2_000,
    );
    expect(() =>
      readAppSessionPointer(
        sealed,
        secret,
        2_001 + APP_SESSION_COOKIE_TTL_SECONDS,
      ),
    ).toThrowError(expect.objectContaining({ code: "SESSION_EXPIRED" }));
  });
});
