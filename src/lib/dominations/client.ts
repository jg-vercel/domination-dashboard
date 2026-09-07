import "server-only";

import { createPkcePair, createRandomToken } from "@/lib/auth/crypto";
import { AuthError } from "@/lib/auth/errors";
import type { AuthDiagnostic, AuthErrorCode } from "@/lib/auth/errors";
import type { DomiNationsCredential } from "@/lib/auth/session";

export const DOMINATIONS_API_ORIGIN = "https://api.dominationsworld.com";
export const XSOLLA_LOGIN_ORIGIN = "https://login.xsolla.com";
export const XSOLLA_LOGIN_PROJECT_ID =
  "8fa0bdc4-6ab1-47e2-91dc-731b88e3607f";
export const WEB_STORE_PROJECT_ID = 277239;

const UPSTREAM_TIMEOUT_MS = 10_000;

export interface DomiNationsAccount {
  gameAccountId: string;
  name: string;
  age: number | null;
  trophies: number | null;
  clientVersion: string | null;
}

export interface StoreProduct {
  name: string;
  sku: string;
  offerId: string;
  price: number | null;
  currency: string;
  isFree: boolean;
  stockAvailable: number | null;
  stockMax: number | null;
  noInventory: boolean;
  disabled: boolean;
  locked: boolean;
  refreshSeconds: number | null;
  validUntil: string | null;
  tags: string[];
}

interface UpstreamRequestOptions extends RequestInit {
  domiCredentials?: DomiNationsCredential;
}

export async function connectDomiNations(
  googleAccessToken: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<DomiNationsCredential> {
  const xsollaToken = await exchangeXsollaToken(
    googleAccessToken,
    fetchImplementation,
  );
  return connectDomiNationsWithXsollaToken(xsollaToken, fetchImplementation);
}

export async function connectDomiNationsWithXsollaToken(
  xsollaToken: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<DomiNationsCredential> {
  const pkce = createPkcePair();
  const clientId = createRandomToken(32);
  let cookies: string[] = [];

  const signupResponse = await requestUpstream(
    `${DOMINATIONS_API_ORIGIN}/api/accounts/signup`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        codeChallenge: pkce.challenge,
        scope: "",
        state: "",
        jwt: xsollaToken,
        password: "",
      }),
    },
    fetchImplementation,
  );
  cookies = mergeCookies(cookies, readResponseCookies(signupResponse.headers));

  if (!signupResponse.ok) {
    rejectUpstreamAuthentication(
      "DOMINATIONS_SIGNUP_REJECTED",
      "dominations_signup",
      signupResponse.status,
    );
  }

  const signupPayload = await readAuthenticationPayload(
    signupResponse,
    "DOMINATIONS_SIGNUP_REJECTED",
    "dominations_signup",
  );
  const signupErrorReason = classifySignupErrorReason(signupPayload.errorReason);
  const authcodePresent =
    typeof signupPayload.authcode === "string" &&
    signupPayload.authcode.trim().length > 0;
  if (
    (signupErrorReason !== "absent" && signupErrorReason !== "empty") ||
    !authcodePresent
  ) {
    rejectUpstreamAuthentication(
      "DOMINATIONS_SIGNUP_REJECTED",
      "dominations_signup",
      signupResponse.status,
      { reason: signupErrorReason, authcodePresent },
    );
  }

  const tokenResponse = await requestUpstream(
    `${DOMINATIONS_API_ORIGIN}/api/accounts/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookies.length ? { Cookie: cookies.join("; ") } : {}),
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: clientId,
        code_verifier: pkce.verifier,
        code: signupPayload.authcode,
        redirect_uri: "",
      }),
    },
    fetchImplementation,
  );
  cookies = mergeCookies(cookies, readResponseCookies(tokenResponse.headers));

  if (!tokenResponse.ok) {
    rejectUpstreamAuthentication(
      "DOMINATIONS_TOKEN_REJECTED",
      "dominations_token",
      tokenResponse.status,
    );
  }

  const tokenPayload = await readAuthenticationPayload(
    tokenResponse,
    "DOMINATIONS_TOKEN_REJECTED",
    "dominations_token",
  );
  if (typeof tokenPayload.token !== "string" || !tokenPayload.token) {
    rejectUpstreamAuthentication(
      "DOMINATIONS_TOKEN_REJECTED",
      "dominations_token",
      tokenResponse.status,
    );
  }

  return {
    accessToken: tokenPayload.token,
    cookies,
    userId: stringValue(tokenPayload.userid),
    xsollaId: stringValue(tokenPayload.xsid),
  };
}

export async function listGameAccountIds(
  credentials: DomiNationsCredential,
  fetchImplementation: typeof fetch = fetch,
): Promise<string[]> {
  const response = await dominationsRequest(
    "/api/gameident/dom/list",
    { method: "POST", body: JSON.stringify({}), domiCredentials: credentials },
    fetchImplementation,
  );
  return readAccountResponse(response, "game_account_list", (payload) => {
    const gameIds = payload.gameIds;
    // The official store indexes gameIds by account ID, with metadata as values.
    if (isRecord(gameIds)) {
      const entries = Object.entries(gameIds);
      if (entries.every(([id, metadata]) => id.trim().length > 0 && isRecord(metadata))) {
        return entries.map(([id]) => id);
      }
    }
    // Retain compatibility with earlier array responses, without dropping bad IDs.
    if (
      Array.isArray(gameIds) &&
      gameIds.every((id): id is string => typeof id === "string" && id.trim().length > 0)
    ) {
      return gameIds;
    }
    throw new AuthError("UPSTREAM_UNAVAILABLE");
  });
}

export async function getLinkedAccounts(
  credentials: DomiNationsCredential,
  fetchImplementation: typeof fetch = fetch,
): Promise<DomiNationsAccount[]> {
  const response = await dominationsRequest(
    "/api/dominations/linked_user_info",
    { method: "GET", domiCredentials: credentials },
    fetchImplementation,
  );
  return readAccountResponse(response, "linked_accounts", (payload) => {
    if (!Array.isArray(payload.accounts)) {
      throw new AuthError("UPSTREAM_UNAVAILABLE");
    }
    return payload.accounts.map(normalizeAccount);
  });
}

export async function getGameAccountInfo(
  credentials: DomiNationsCredential,
  gameAccountId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<DomiNationsAccount> {
  const response = await dominationsRequest(
    `/api/dominations/${encodeURIComponent(gameAccountId)}/user_info`,
    { method: "GET", domiCredentials: credentials },
    fetchImplementation,
  );
  return readAccountResponse(response, "game_account_info", (payload) =>
    normalizeAccount({ ...payload, gameAccountId }),
  );
}

export async function getProductsForAccount(
  credentials: DomiNationsCredential,
  gameAccountId: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<StoreProduct[]> {
  const response = await dominationsRequest(
    "/api/xsollastore/getproducts",
    {
      method: "POST",
      body: JSON.stringify({
        gameAccountId,
        projectId: WEB_STORE_PROJECT_ID,
        locale: "en-US",
      }),
      domiCredentials: credentials,
    },
    fetchImplementation,
  );

  let payload: unknown;
  try {
    payload = await response.json();
    if (typeof payload === "string") {
      payload = JSON.parse(payload) as unknown;
    }
  } catch (error) {
    throw new AuthError("UPSTREAM_UNAVAILABLE", { cause: error });
  }

  if (!Array.isArray(payload)) {
    throw new AuthError("UPSTREAM_UNAVAILABLE");
  }

  return payload.map(normalizeProduct);
}

export async function startFreePurchase(
  credentials: DomiNationsCredential,
  gameAccountId: string,
  product: StoreProduct,
  fetchImplementation: typeof fetch = fetch,
): Promise<"free"> {
  const isFree = product.isFree || product.price === 0;
  if (
    !isFree || !product.sku ||
    product.disabled || product.noInventory || product.locked
  ) {
    throw new AuthError("PURCHASE_NOT_ELIGIBLE");
  }

  const response = await dominationsRequest(
    "/api/xsollastore/startpurchase",
    {
      method: "POST",
      body: JSON.stringify({
        gameAccountId,
        itemSku: product.sku,
        offerId: product.offerId,
        quantity: 1,
        locale: "en-US",
        returnToken: true,
        targetUserHash: "",
        domgl: false,
        anonymize: false,
        projectId: WEB_STORE_PROJECT_ID,
      }),
      domiCredentials: credentials,
    },
    fetchImplementation,
  );
  const payload = await readObject(response);

  if (payload.orderAccessToken !== "free") {
    throw new AuthError("PAID_CHECKOUT_REJECTED");
  }
  return "free";
}

async function exchangeXsollaToken(
  googleAccessToken: string,
  fetchImplementation: typeof fetch,
): Promise<string> {
  const url = new URL(
    "/api/social/google/login_with_token",
    XSOLLA_LOGIN_ORIGIN,
  );
  url.searchParams.set("projectId", XSOLLA_LOGIN_PROJECT_ID);
  url.searchParams.set("with_logout", "0");

  const response = await requestUpstream(
    url.toString(),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_token: googleAccessToken }),
    },
    fetchImplementation,
  );

  if (!response.ok) {
    rejectUpstreamAuthentication(
      "XSOLLA_GOOGLE_TOKEN_REJECTED",
      "xsolla_google_token",
      response.status,
    );
  }

  const payload = await readAuthenticationPayload(
    response,
    "XSOLLA_GOOGLE_TOKEN_REJECTED",
    "xsolla_google_token",
  );
  if (typeof payload.token !== "string" || !payload.token) {
    rejectUpstreamAuthentication(
      "XSOLLA_GOOGLE_TOKEN_REJECTED",
      "xsolla_google_token",
      response.status,
    );
  }
  return payload.token;
}

type UpstreamAuthenticationStage =
  | "xsolla_google_token"
  | "dominations_signup"
  | "dominations_token";

type UpstreamAuthenticationErrorCode = Extract<
  AuthErrorCode,
  | "XSOLLA_GOOGLE_TOKEN_REJECTED"
  | "DOMINATIONS_SIGNUP_REJECTED"
  | "DOMINATIONS_TOKEN_REJECTED"
>;

const SIGNUP_ERROR_REASONS = [
  "claimedCredentials",
  "unverifiedEmail",
  "wrongCredentials",
  "invalidPassword",
  "userExists",
  "unknownError",
  "serverError",
  "newAccountVerifyEmail",
  "wrongPassword",
  "tooManyRequests",
  "bannedUser",
  "alwaysFailCase",
  "signupRequired",
] as const;

type SignupErrorReason =
  | (typeof SIGNUP_ERROR_REASONS)[number]
  | "absent"
  | "empty"
  | "malformed"
  | "unknown";

function classifySignupErrorReason(value: unknown): SignupErrorReason {
  if (value === undefined) return "absent";
  if (value === "") return "empty";
  if (typeof value !== "string") return "malformed";
  return SIGNUP_ERROR_REASONS.find((reason) => reason === value) ?? "unknown";
}

async function readAuthenticationPayload(
  response: Response,
  code: UpstreamAuthenticationErrorCode,
  stage: UpstreamAuthenticationStage,
): Promise<Record<string, unknown>> {
  try {
    return await readObject(response);
  } catch {
    rejectUpstreamAuthentication(code, stage, response.status);
  }
}

function rejectUpstreamAuthentication(
  code: UpstreamAuthenticationErrorCode,
  stage: UpstreamAuthenticationStage,
  status: number,
  signupDetails?: { reason: SignupErrorReason; authcodePresent: boolean },
): never {
  console.warn("Upstream authentication rejected", {
    stage,
    status,
    ...signupDetails,
  });
  throw new AuthError(code, { diagnostic: { stage, status } });
}

async function dominationsRequest(
  path: string,
  options: UpstreamRequestOptions,
  fetchImplementation: typeof fetch,
): Promise<Response> {
  const { domiCredentials, headers, ...requestOptions } = options;
  const response = await requestUpstream(
    `${DOMINATIONS_API_ORIGIN}${path}`,
    {
      ...requestOptions,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${domiCredentials?.accessToken ?? ""}`,
        ...(domiCredentials?.cookies.length
          ? { Cookie: domiCredentials.cookies.join("; ") }
          : {}),
        ...headers,
      },
    },
    fetchImplementation,
  );

  if (response.status === 401) {
    throw new AuthError("SESSION_EXPIRED", {
      diagnostic: { stage: upstreamStage(path), status: response.status, reason: "http" },
    });
  }
  if (!response.ok) {
    throw new AuthError("UPSTREAM_UNAVAILABLE", {
      diagnostic: { stage: upstreamStage(path), status: response.status, reason: "http" },
    });
  }
  return response;
}

async function requestUpstream(
  url: string,
  options: RequestInit,
  fetchImplementation: typeof fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    return await fetchImplementation(url, {
      ...options,
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
  } catch (error) {
    throw new AuthError("UPSTREAM_UNAVAILABLE", {
      cause: error,
      diagnostic: { stage: upstreamStage(new URL(url).pathname), reason: "network" },
    });
  } finally {
    clearTimeout(timeout);
  }
}

function upstreamStage(path: string): AuthDiagnostic["stage"] {
  if (/^\/api\/dominations\/[^/]+\/user_info$/.test(path)) {
    return "game_account_info";
  }
  switch (path) {
    case "/api/social/google/login_with_token": return "xsolla_google_token";
    case "/api/accounts/signup": return "dominations_signup";
    case "/api/accounts/token": return "dominations_token";
    case "/api/gameident/dom/list": return "game_account_list";
    case "/api/dominations/linked_user_info": return "linked_accounts";
    case "/api/xsollastore/getproducts": return "store_products";
    case "/api/xsollastore/startpurchase": return "free_purchase";
    default: throw new Error("Unknown upstream endpoint");
  }
}

async function readAccountResponse<T>(
  response: Response,
  stage: "game_account_list" | "linked_accounts" | "game_account_info",
  parse: (payload: Record<string, unknown>) => T,
): Promise<T> {
  try {
    return parse(await readObject(response));
  } catch (error) {
    throw new AuthError("UPSTREAM_UNAVAILABLE", {
      cause: error,
      diagnostic: { stage, status: response.status, reason: "response_shape" },
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readObject(response: Response): Promise<Record<string, unknown>> {
  try {
    const payload: unknown = await response.json();
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new AuthError("UPSTREAM_UNAVAILABLE");
    }
    return payload as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    throw new AuthError("UPSTREAM_UNAVAILABLE", { cause: error });
  }
}

function normalizeAccount(value: unknown): DomiNationsAccount {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AuthError("UPSTREAM_UNAVAILABLE");
  }
  const account = value as Record<string, unknown>;
  if (typeof account.gameAccountId !== "string" || !account.gameAccountId) {
    throw new AuthError("UPSTREAM_UNAVAILABLE");
  }

  return {
    gameAccountId: account.gameAccountId,
    name: typeof account.name === "string" ? account.name : "Unknown commander",
    age: finiteNumber(account.age),
    trophies: finiteNumber(account.trophies),
    clientVersion:
      typeof account.clientMajorVersion === "string"
        ? account.clientMajorVersion
        : null,
  };
}

function normalizeProduct(value: unknown): StoreProduct {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AuthError("UPSTREAM_UNAVAILABLE");
  }
  const product = value as Record<string, unknown>;

  return {
    name: stringValue(product.name),
    sku: stringValue(product.google),
    offerId: stringValue(product.offerId),
    price: finiteNumber(product.price),
    currency: stringValue(product.currency),
    isFree: product.is_free === true,
    stockAvailable: finiteNumber(product.stockAvailable),
    stockMax: finiteNumber(product.stockMax),
    noInventory: restrictionFlag(product.noInventory),
    disabled: restrictionFlag(product.disabled),
    locked: restrictionFlag(product.locked),
    refreshSeconds: finiteNumber(product.refresh),
    validUntil: typeof product.validUntil === "string" ? product.validUntil : null,
    tags: Array.isArray(product.tags)
      ? product.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
  };
}

function restrictionFlag(value: unknown): boolean {
  // The store also sends numeric flags. Only explicit false/empty values clear a
  // purchase restriction; unknown strings, numbers, or objects remain blocked.
  if (value === undefined || value === null || value === false || value === 0) {
    return false;
  }
  if (typeof value === "string") return value.trim() !== "" && value !== "0";
  return true;
}

function readResponseCookies(headers: Headers): string[] {
  const extendedHeaders = headers as Headers & { getSetCookie?: () => string[] };
  const setCookieValues =
    extendedHeaders.getSetCookie?.() ??
    (headers.get("set-cookie") ? [headers.get("set-cookie")!] : []);

  return setCookieValues
    .map((value) => value.split(";", 1)[0]?.trim())
    .filter((value): value is string => Boolean(value && value.includes("=")));
}

function mergeCookies(existing: string[], incoming: string[]): string[] {
  const jar = new Map<string, string>();
  for (const cookie of [...existing, ...incoming]) {
    const separator = cookie.indexOf("=");
    if (separator > 0) {
      jar.set(cookie.slice(0, separator), cookie);
    }
  }
  return [...jar.values()];
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) {
    return null;
  }
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}
