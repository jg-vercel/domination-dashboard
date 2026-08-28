// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { GET as getHealth } from "@/app/api/health/route";
import { GET as getOutboundCountry } from "@/app/api/system/outbound-country/route";
import { GET as getRegion } from "@/app/api/system/region/route";

describe("system Route Handlers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("returns health without caching", async () => {
    const response = getHealth();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toMatchObject({ ok: true, service: "domination-dashboard" });
  });

  it("returns only allowlisted Vercel runtime fields", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_REGION", "iad1");
    vi.stubEnv("SHOULD_NOT_LEAK", "secret-value");

    const response = getRegion();
    const body = await response.json();

    expect(body.runtime).toMatchObject({
      configuredRegion: "iad1",
      runtimeRegion: "iad1",
      regionMatches: true,
      platform: "vercel",
    });
    expect(JSON.stringify(body)).not.toContain("SHOULD_NOT_LEAK");
    expect(JSON.stringify(body)).not.toContain("secret-value");
  });

  it("returns a normalized country response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({ countryCode: "US", asia: false, apiEnabled: true }),
      ),
    );

    const response = await getOutboundCountry();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body.network).toEqual({
      countryCode: "US",
      asia: false,
      apiEnabled: true,
      targetCountryCode: "US",
      targetMet: true,
    });
  });

  it("does not expose an upstream error body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response("private upstream details", { status: 503 }),
      ),
    );

    const response = await getOutboundCountry();
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({
      ok: false,
      error: {
        code: "UPSTREAM_HTTP_ERROR",
        message: "외부 네트워크 위치를 확인하지 못했습니다.",
      },
    });
    expect(JSON.stringify(body)).not.toContain("private upstream details");
  });
});
