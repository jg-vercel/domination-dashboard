import { NextResponse } from "next/server";

import {
  DiagnosticError,
  fetchCountryDiagnostic,
} from "@/lib/system/diagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const network = await fetchCountryDiagnostic();

    return NextResponse.json(
      {
        ok: true,
        checkedAt: new Date().toISOString(),
        source: "dominationsworld-public-country-check",
        network,
      },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    const diagnosticError =
      error instanceof DiagnosticError
        ? error
        : new DiagnosticError("UPSTREAM_UNAVAILABLE", 502);

    return NextResponse.json(
      {
        ok: false,
        error: {
          code: diagnosticError.code,
          message: "외부 네트워크 위치를 확인하지 못했습니다.",
        },
      },
      { status: diagnosticError.status, headers: noStoreHeaders },
    );
  }
}
