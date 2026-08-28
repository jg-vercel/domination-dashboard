import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ClaimAuditList } from "./claim-audit-list";

describe("ClaimAuditList", () => {
  afterEach(cleanup);

  it("renders a safe empty state", () => {
    render(<ClaimAuditList entries={[]} />);
    expect(screen.getByText("아직 수령 기록이 없습니다.")).toBeInTheDocument();
  });

  it("renders cycle summary and masked per-account results", () => {
    render(
      <ClaimAuditList
        entries={[
          {
            version: 1,
            cycleId: "2026-08-28",
            executedAt: "2026-08-28T00:01:00.000Z",
            summary: {
              success: 1,
              already_claimed: 1,
              duplicate: 0,
              ineligible: 0,
              failed: 0,
              uncertain: 0,
            },
            results: [
              {
                accountName: "Commander 1",
                maskedAccountId: "••••0001",
                status: "success",
                reason: "CONFIRMED",
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText("Cycle 2026-08-28")).toBeInTheDocument();
    expect(screen.getByText("성공 1")).toBeInTheDocument();
    expect(screen.getByText("이미 수령 1")).toBeInTheDocument();
    expect(
      screen.getByText("Commander 1 · ••••0001 · 성공"),
    ).toBeInTheDocument();
  });
});
