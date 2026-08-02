import { getOperationalSummary } from "@siftloom/db";
import { NextResponse } from "next/server";

import { getAuthContext } from "@/lib/server/auth-context";
import { getRuntimeDatabaseClient } from "@/lib/server/database";
import { unauthorized } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await getAuthContext();
  if (!context) return unauthorized();

  const summary = await getOperationalSummary(getRuntimeDatabaseClient().db, context.scope);
  return NextResponse.json(
    { summary },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
