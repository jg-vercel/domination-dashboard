export type AuthErrorCode =
  | "AUTH_NOT_CONFIGURED"
  | "OAUTH_FLOW_INVALID"
  | "OAUTH_PROVIDER_ERROR"
  | "GOOGLE_TOKEN_REJECTED"
  | "GOOGLE_REFRESH_TOKEN_MISSING"
  | "GOOGLE_REFRESH_REJECTED"
  | "DOMINATIONS_AUTH_REJECTED"
  | "XSOLLA_GOOGLE_TOKEN_REJECTED"
  | "DOMINATIONS_SIGNUP_REJECTED"
  | "DOMINATIONS_TOKEN_REJECTED"
  | "DOMINATIONS_SESSION_REQUIRED"
  | "ACCOUNT_DIRECTORY_INVALID"
  | "SESSION_INVALID"
  | "SESSION_EXPIRED"
  | "SESSION_TOO_LARGE"
  | "PURCHASE_NOT_ELIGIBLE"
  | "PAID_CHECKOUT_REJECTED"
  | "UPSTREAM_UNAVAILABLE";

export interface AuthDiagnostic {
  stage:
    | "google_refresh"
    | "xsolla_google_token"
    | "dominations_signup"
    | "dominations_token"
    | "game_account_list"
    | "linked_accounts"
    | "game_account_info"
    | "store_products"
    | "free_purchase";
  status?: number;
  reason?: "network" | "http" | "response_shape";
}

export class AuthError extends Error {
  public readonly diagnostic?: AuthDiagnostic;

  constructor(
    public readonly code: AuthErrorCode,
    options?: ErrorOptions & { diagnostic?: AuthDiagnostic },
  ) {
    super(code, options);
    this.name = "AuthError";
    this.diagnostic = options?.diagnostic;
  }
}

export function asAuthError(error: unknown): AuthError {
  return error instanceof AuthError
    ? error
    : new AuthError("UPSTREAM_UNAVAILABLE", { cause: error });
}
