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
    expect(screen.getByText("수령 성공 1")).toBeInTheDocument();
    expect(screen.getByText("이미 수령 1")).toBeInTheDocument();
    expect(
      screen.getByText("Commander 1 · ••••0001 · 수령 성공"),
    ).toBeInTheDocument();
    expect(screen.getByText("상점의 수령 결과를 확인했습니다.")).toBeInTheDocument();
  });

  it("shows prior uncertain outcomes and safe legacy explanations instead of implying new purchases", () => {
    render(<ClaimAuditList entries={[{
      version: 1, cycleId: "2026-08-28", executedAt: "2026-08-28T00:01:00.000Z",
      summary: { success: 0, already_claimed: 0, duplicate: 0, ineligible: 1, failed: 0, uncertain: 1 },
      results: [
        { accountName: "One", maskedAccountId: "••••0001", status: "uncertain", reason: "PREVIOUS_OUTCOME_UNKNOWN", replayed: true },
        { accountName: "Two", maskedAccountId: "••••0002", status: "ineligible", reason: "PAID_TOKEN_REJECTED", replayed: true },
      ],
    }]} />);

    expect(screen.getByText("One · ••••0001 · 직접 확인 필요")).toBeInTheDocument();
    expect(screen.getAllByText("이전 기록 · 재전송하지 않음")).toHaveLength(2);
    expect(screen.getByText("이전 기록만으로 수령 결과를 확인할 수 없어 재전송하지 않았습니다.")).toBeInTheDocument();
    expect(screen.getByText("무료 수령 응답을 확인하지 못해 재전송을 보류했습니다.")).toBeInTheDocument();
    expect(screen.queryByText(/유료/)).not.toBeInTheDocument();
  });
});
