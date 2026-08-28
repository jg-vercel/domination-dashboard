export const TARGET_VERCEL_REGION = "iad1";
export const TARGET_COUNTRY_CODE = "US";
export const DEFAULT_COUNTRY_ENDPOINT =
  "https://api.dominationsworld.com/api/gameident/getplayercountry";
export const COUNTRY_DIAGNOSTIC_TIMEOUT_MS = 5_000;

export type RuntimePlatform = "local" | "vercel";

export interface RuntimeDiagnostic {
  configuredRegion: typeof TARGET_VERCEL_REGION;
  runtimeRegion: string;
  regionMatches: boolean;
  platform: RuntimePlatform;
  nodeVersion: string;
}

export interface CountryDiagnostic {
  countryCode: string;
  asia: boolean;
  apiEnabled: boolean;
  targetCountryCode: typeof TARGET_COUNTRY_CODE;
  targetMet: boolean;
}

export interface RuntimeEnvironment {
  VERCEL?: string;
  VERCEL_REGION?: string;
}

export type DiagnosticErrorCode =
  | "UPSTREAM_HTTP_ERROR"
  | "UPSTREAM_INVALID_RESPONSE"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_UNAVAILABLE";

export class DiagnosticError extends Error {
  constructor(
    public readonly code: DiagnosticErrorCode,
    public readonly status: number,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "DiagnosticError";
  }
}

export function getRuntimeDiagnostic(
  environment: RuntimeEnvironment = {
    VERCEL: process.env.VERCEL,
    VERCEL_REGION: process.env.VERCEL_REGION,
  },
  nodeVersion = process.versions.node,
): RuntimeDiagnostic {
  const runtimeRegion = environment.VERCEL_REGION ?? "local";

  return {
    configuredRegion: TARGET_VERCEL_REGION,
    runtimeRegion,
    regionMatches: runtimeRegion === TARGET_VERCEL_REGION,
    platform: environment.VERCEL === "1" ? "vercel" : "local",
    nodeVersion,
  };
}

export function normalizeCountryDiagnostic(payload: unknown): CountryDiagnostic {
  if (!isRecord(payload)) {
    throw new DiagnosticError("UPSTREAM_INVALID_RESPONSE", 502);
  }

  const countryCode =
    typeof payload.countryCode === "string"
      ? payload.countryCode.trim().toUpperCase()
      : "";

  if (
    !/^[A-Z]{2}$/.test(countryCode) ||
    typeof payload.asia !== "boolean" ||
    typeof payload.apiEnabled !== "boolean"
  ) {
    throw new DiagnosticError("UPSTREAM_INVALID_RESPONSE", 502);
  }

  return {
    countryCode,
    asia: payload.asia,
    apiEnabled: payload.apiEnabled,
    targetCountryCode: TARGET_COUNTRY_CODE,
    targetMet: countryCode === TARGET_COUNTRY_CODE && payload.asia === false,
  };
}

export async function fetchCountryDiagnostic(
  fetchImplementation: typeof fetch = fetch,
  endpoint = process.env.DOMINATIONS_COUNTRY_ENDPOINT ?? DEFAULT_COUNTRY_ENDPOINT,
  timeoutMs = COUNTRY_DIAGNOSTIC_TIMEOUT_MS,
): Promise<CountryDiagnostic> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImplementation(endpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new DiagnosticError("UPSTREAM_HTTP_ERROR", 502);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new DiagnosticError("UPSTREAM_INVALID_RESPONSE", 502, {
        cause: error,
      });
    }

    return normalizeCountryDiagnostic(payload);
  } catch (error) {
    if (error instanceof DiagnosticError) {
      throw error;
    }

    if (controller.signal.aborted) {
      throw new DiagnosticError("UPSTREAM_TIMEOUT", 504, { cause: error });
    }

    throw new DiagnosticError("UPSTREAM_UNAVAILABLE", 502, { cause: error });
  } finally {
    clearTimeout(timeout);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
