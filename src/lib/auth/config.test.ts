import { describe, expect, it } from "vitest";

import { getAuthConfig, getAuthReadiness } from "./config";

const validEnvironment = {
  GOOGLE_CLIENT_ID: "google-client-id",
  GOOGLE_CLIENT_SECRET: "google-client-secret",
  APP_SESSION_SECRET: "a-secure-session-secret-with-32-characters",
  NODE_ENV: "development",
};

describe("auth configuration", () => {
  it("lists every missing required value without exposing values", () => {
    expect(getAuthReadiness({ NODE_ENV: "development" })).toEqual({
      configured: false,
      missing: [
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "APP_SESSION_SECRET",
      ],
    });
  });

  it("normalizes the local base URL", () => {
    expect(getAuthConfig(validEnvironment)).toMatchObject({
      baseUrl: "http://localhost:3000",
      secureCookies: false,
    });
  });

  it("requires an explicit production base URL", () => {
    expect(
      getAuthReadiness({ ...validEnvironment, NODE_ENV: "production" }),
    ).toMatchObject({ configured: false, missing: ["APP_BASE_URL"] });
  });
});
