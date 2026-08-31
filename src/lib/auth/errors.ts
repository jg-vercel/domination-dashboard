export type AuthErrorCode =
  | "AUTH_NOT_CONFIGURED"
  | "OAUTH_FLOW_INVALID"
  | "OAUTH_PROVIDER_ERROR"
  | "GOOGLE_TOKEN_REJECTED"
  | "GOOGLE_REFRESH_TOKEN_MISSING"
  | "GOOGLE_REFRESH_REJECTED"
  | "DOMINATIONS_AUTH_REJECTED"
  | "ACCOUNT_COUNT_MISMATCH"
  | "SESSION_INVALID"
  | "SESSION_EXPIRED"
  | "SESSION_TOO_LARGE"
  | "PURCHASE_NOT_ELIGIBLE"
  | "PAID_CHECKOUT_REJECTED"
  | "UPSTREAM_UNAVAILABLE";

export class AuthError extends Error {
  constructor(
    public readonly code: AuthErrorCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "AuthError";
  }
}

export function asAuthError(error: unknown): AuthError {
  return error instanceof AuthError
    ? error
    : new AuthError("UPSTREAM_UNAVAILABLE", { cause: error });
}
