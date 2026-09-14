import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AuthControl } from "./auth-control";

afterEach(cleanup);

describe("authentication controls", () => {
  it.each([
    [false, false, "Google 로그인 준비 중"],
    [false, true, "Google 로그인 준비 중"],
    [true, false, "로그인 저장소 준비 중"],
  ])("distinguishes server configuration (%s, %s)", (authConfigured, storeConfigured, label) => {
    render(<AuthControl authConfigured={authConfigured} storeConfigured={storeConfigured} session={null} />);
    expect(screen.getByRole("status")).toHaveTextContent(label);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText(/env.local/)).not.toBeInTheDocument();
  });

  it("offers Google login when configured and signed out", () => {
    render(<AuthControl authConfigured storeConfigured session={null} />);
    expect(screen.getByRole("link", { name: /Google로 로그인/ })).toHaveAttribute("href", "/api/auth/google/start");
  });

  it("offers retry instead of reauthentication on a temporary store failure", () => {
    render(<AuthControl authConfigured storeConfigured session={null} unavailable />);
    expect(screen.getByRole("button", { name: /로그인 상태 확인 지연/ }).closest("form")).toHaveAttribute("action", "/");
    expect(screen.queryByText("Google로 로그인")).not.toBeInTheDocument();
  });

  it("shows the saved identity and logout for an existing session", () => {
    render(<AuthControl authConfigured storeConfigured session={{
      issuedAt: 1, expiresAt: 2,
      admin: { subject: "subject", name: "사용자", email: "user@example.com" },
      dominations: null, claimCsrfToken: "csrf",
    }} />);
    expect(screen.getByText("user@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "로그아웃" }).closest("form")).toHaveAttribute("action", "/api/auth/logout");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
