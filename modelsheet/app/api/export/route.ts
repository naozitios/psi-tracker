import { workbookToXlsx } from "@/lib/export/xlsx";
import { jsonError } from "@/lib/http";
import { exportBlockers, runChecks } from "@/lib/model/checks";
import { evaluateWorkbook } from "@/lib/sheet/engine";
import type { Workbook } from "@/lib/sheet/types";

// POST { workbook } returns an .xlsx. Export is refused while any integrity
// check fails, so a broken model never leaves the app looking finished.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { workbook?: Workbook } | null;
  const workbook = body?.workbook;
  if (!workbook?.sheets) return jsonError("Missing workbook.", 400);

  const values = evaluateWorkbook(workbook);
  const checks = runChecks(workbook, values);
  const blockers = exportBlockers(checks);
  if (blockers.length) {
    return Response.json(
      { error: "Fix the failing checks before exporting.", checks: blockers },
      { status: 422 },
    );
  }

  const buffer = await workbookToXlsx(workbook, values, checks);
  const ticker = (workbook.company.ticker || "model").replace(/[^A-Za-z0-9-]/g, "");
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${ticker}-model.xlsx"`,
    },
  });
}
