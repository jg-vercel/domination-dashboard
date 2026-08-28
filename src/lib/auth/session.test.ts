import { describe, expect, it } from "vitest";

import { AuthError } from "./errors";
import {
  createAppSession,
  createOAuthFlow,
  readAppSession,
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
    const tampered = `${sealed.slice(0, -1)}x`;

    expect(() => readOAuthFlow(tampered, secret, 1_001)).toThrowError(
      AuthError,
    );
    expect(() => readOAuthFlow(sealed, secret, 1_601)).toThrowError(
      expect.objectContaining({ code: "SESSION_EXPIRED" }),
    );
  });
});

describe("sealed app session", () => {
  it("keeps raw DomiNations credentials encrypted", () => {
    const { session, sealed } = createAppSession(
      {
        subject: "google-subject",
        email: "admin@example.com",
        name: "Admin",
      },
      {
        accessToken: "raw-dominations-token",
        cookies: ["domi_session=raw-cookie"],
        userId: "user-1",
        xsollaId: "xsolla-1",
      },
      secret,
      2_000,
    );

    expect(sealed).not.toContain("raw-dominations-token");
    expect(sealed).not.toContain("raw-cookie");
    expect(readAppSession(sealed, secret, 2_001)).toEqual(session);
  });

  it("fails closed when encrypted credentials exceed the cookie limit", () => {
    expect(() =>
      createAppSession(
        {
          subject: "google-subject",
          email: "admin@example.com",
          name: "Admin",
        },
        {
          accessToken: "x".repeat(4_000),
          cookies: [],
          userId: "user-1",
          xsollaId: "xsolla-1",
        },
        secret,
        2_000,
      ),
    ).toThrowError(expect.objectContaining({ code: "SESSION_TOO_LARGE" }));
  });
});
