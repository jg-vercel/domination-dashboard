import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { AuthError } from "./errors";

const SEALED_VERSION = "v1";
const SEALED_AAD = Buffer.from("domination-dashboard:sealed:v1", "utf8");
export const MAX_SEALED_COOKIE_BYTES = 3_500;

export interface ExpiringPayload {
  issuedAt: number;
  expiresAt: number;
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export function createRandomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function createPkcePair(): PkcePair {
  const verifier = createRandomToken(32);
  const challenge = createHash("sha256")
    .update(verifier, "ascii")
    .digest("base64url");
  return { verifier, challenge };
}

export function secureStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function sealPayload<T extends ExpiringPayload>(
  payload: T,
  secret: string,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  cipher.setAAD(SEALED_AAD);

  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const authenticationTag = cipher.getAuthTag();
  const sealed = [
    SEALED_VERSION,
    iv.toString("base64url"),
    encrypted.toString("base64url"),
    authenticationTag.toString("base64url"),
  ].join(".");

  if (Buffer.byteLength(sealed, "utf8") > MAX_SEALED_COOKIE_BYTES) {
    throw new AuthError("SESSION_TOO_LARGE");
  }

  return sealed;
}

export function unsealPayload<T extends ExpiringPayload>(
  sealed: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
): T {
  try {
    const [version, ivValue, encryptedValue, authenticationTagValue, extra] =
      sealed.split(".");

    if (
      version !== SEALED_VERSION ||
      !ivValue ||
      !encryptedValue ||
      !authenticationTagValue ||
      extra
    ) {
      throw new AuthError("SESSION_INVALID");
    }

    const decipher = createDecipheriv(
      "aes-256-gcm",
      deriveKey(secret),
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAAD(SEALED_AAD);
    decipher.setAuthTag(Buffer.from(authenticationTagValue, "base64url"));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const payload = JSON.parse(decrypted) as T;

    if (
      typeof payload.issuedAt !== "number" ||
      typeof payload.expiresAt !== "number" ||
      payload.issuedAt > nowSeconds + 60 ||
      payload.expiresAt <= nowSeconds
    ) {
      throw new AuthError("SESSION_EXPIRED");
    }

    return payload;
  } catch (error) {
    if (error instanceof AuthError) {
      throw error;
    }
    throw new AuthError("SESSION_INVALID", { cause: error });
  }
}

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}
