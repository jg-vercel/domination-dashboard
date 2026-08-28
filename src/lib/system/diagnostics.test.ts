import { describe, expect, it, vi } from "vitest";

import {
  DiagnosticError,
  fetchCountryDiagnostic,
  getRuntimeDiagnostic,
  normalizeCountryDiagnostic,
} from "./diagnostics";

describe("getRuntimeDiagnostic", () => {
  it("reports iad1 as a matching Vercel runtime", () => {
    expect(
      getRuntimeDiagnostic({ VERCEL: "1", VERCEL_REGION: "iad1" }, "24.4.0"),
    ).toEqual({
      configuredRegion: "iad1",
      runtimeRegion: "iad1",
      regionMatches: true,
      platform: "vercel",
      nodeVersion: "24.4.0",
    });
  });

  it("marks an unset environment as local", () => {
    expect(getRuntimeDiagnostic({}, "25.9.0")).toMatchObject({
      runtimeRegion: "local",
      regionMatches: false,
      platform: "local",
    });
  });
});

describe("normalizeCountryDiagnostic", () => {
  it("accepts the expected US response", () => {
    expect(
      normalizeCountryDiagnostic({
        countryCode: "us",
        asia: false,
        apiEnabled: true,
      }),
    ).toEqual({
      countryCode: "US",
      asia: false,
      apiEnabled: true,
      targetCountryCode: "US",
      targetMet: true,
    });
  });

  it("rejects missing or incorrectly typed fields", () => {
    expect(() =>
      normalizeCountryDiagnostic({ countryCode: "US", asia: "false" }),
    ).toThrowError(DiagnosticError);
  });
});

describe("fetchCountryDiagnostic", () => {
  it("uses a read-only, non-cached request and normalizes the response", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ countryCode: "KR", asia: true, apiEnabled: true }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(
      fetchCountryDiagnostic(fetchMock, "https://example.test/country"),
    ).resolves.toMatchObject({ countryCode: "KR", targetMet: false });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/country",
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );
  });

  it("maps an aborted request to a safe timeout error", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );

    await expect(
      fetchCountryDiagnostic(fetchMock, "https://example.test/country", 1),
    ).rejects.toMatchObject({ code: "UPSTREAM_TIMEOUT", status: 504 });
  });
});
