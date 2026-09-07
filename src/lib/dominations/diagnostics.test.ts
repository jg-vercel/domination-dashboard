import { describe, expect, it, vi } from "vitest";

import type { DomiNationsCredential } from "@/lib/auth/session";

import {
  connectDomiNations,
  connectDomiNationsWithXsollaToken,
  getLinkedAccounts,
  listGameAccountIds,
} from "./client";

const credentials: DomiNationsCredential = {
  accessToken: "private-diagnostic-domi-token",
  cookies: ["private_cookie=private-cookie-value"],
  userId: "private-user-id",
  xsollaId: "private-xsolla-id",
};
const upstreamSecret = "private-upstream-body-and-network-error";
const accountRequests = [
  { stage: "game_account_list", request: listGameAccountIds },
  { stage: "linked_accounts", request: getLinkedAccounts },
] as const;

describe("safe DomiNations connection diagnostics", () => {
  it.each([
    {
      stage: "xsolla_google_token",
      request: (fetchMock: typeof fetch) => connectDomiNations("private-google-token", fetchMock),
      priorResponses: [],
    },
    {
      stage: "dominations_signup",
      request: (fetchMock: typeof fetch) => connectDomiNationsWithXsollaToken("private-xsolla-token", fetchMock),
      priorResponses: [],
    },
    {
      stage: "dominations_token",
      request: (fetchMock: typeof fetch) => connectDomiNationsWithXsollaToken("private-xsolla-token", fetchMock),
      priorResponses: [{ authcode: "private-authorization-code", errorReason: "" }],
    },
    ...accountRequests.map(({ stage, request }) => ({
      stage,
      request: (fetchMock: typeof fetch) => request(credentials, fetchMock),
      priorResponses: [],
    })),
  ])("identifies network failure at $stage without putting error text in diagnostics", async ({ stage, request, priorResponses }) => {
    const fetchMock = vi.fn<typeof fetch>();
    for (const payload of priorResponses) {
      fetchMock.mockResolvedValueOnce(Response.json(payload));
    }
    fetchMock.mockRejectedValueOnce(new TypeError(upstreamSecret));

    await expect(request(fetchMock)).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      diagnostic: { stage, reason: "network" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(priorResponses.length + 1);
  });

  describe.each(accountRequests)("$stage responses", ({ stage, request }) => {
    it.each([401, 403, 503])("reports HTTP %i without copying the upstream response", async (status) => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
        Response.json({ error: upstreamSecret, access_token: credentials.accessToken }, { status }),
      );
      const error = await request(credentials, fetchMock).catch((caught: unknown) => caught);

      expect(error).toMatchObject({
        code: status === 401 ? "SESSION_EXPIRED" : "UPSTREAM_UNAVAILABLE",
        diagnostic: { stage, status, reason: "http" },
      });
      expect(JSON.stringify(error)).not.toContain(upstreamSecret);
      expect(JSON.stringify(error)).not.toContain(credentials.accessToken);
      expect(JSON.stringify(error)).not.toContain(credentials.cookies[0]);
    });

    it.each(["malformed_json", "wrong_shape"])("identifies a %s success response as a response-shape failure", async (kind) => {
      const response = kind === "malformed_json"
        ? new Response(`invalid-json-${upstreamSecret}`, { status: 200 })
        : Response.json({ gameIds: upstreamSecret, accounts: upstreamSecret });
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response);
      const error = await request(credentials, fetchMock).catch((caught: unknown) => caught);

      expect(error).toMatchObject({
        code: "UPSTREAM_UNAVAILABLE",
        diagnostic: { stage, status: 200, reason: "response_shape" },
      });
      expect(JSON.stringify(error)).not.toContain(upstreamSecret);
      expect(JSON.stringify(error)).not.toContain(credentials.accessToken);
    });
  });
});
