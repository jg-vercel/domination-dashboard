import { NextResponse } from "next/server";

import { getRuntimeDiagnostic } from "@/lib/system/diagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      ok: true,
      checkedAt: new Date().toISOString(),
      runtime: getRuntimeDiagnostic(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
