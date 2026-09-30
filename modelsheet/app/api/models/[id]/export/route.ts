import { workbookToXlsx } from "@/lib/export/xlsx";
import { exportBlockers, runChecks } from "@/lib/model/checks";
import { loadModel } from "@/lib/models/store";
import { track } from "@/lib/server/events";
import { withUser } from "@/lib/server/route";
import { evaluateWorkbook } from "@/lib/sheet/engine";

type Context = { params: Promise<{ id: string }> };

// Returns the saved model as .xlsx. Refused while any integrity check
// fails, so a broken model never leaves the app looking finished.
export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  return withUser(request, { create: false }, async ({ db, userId }) => {
    const { workbook } = await loadModel(db, userId, id);
    const values = evaluateWorkbook(workbook);
    const checks = runChecks(workbook, values);
    const blockers = exportBlockers(checks);
    if (blockers.length) {
      await track(db, { name: "export_blocked", userId, modelId: id, props: { checks: blockers.map((c) => c.id) } });
      return Response.json({ error: "Fix the failing checks before exporting.", checks: blockers }, { status: 422 });
    }

    const buffer = await workbookToXlsx(workbook, values, checks);
    await track(db, { name: "export_downloaded", userId, modelId: id });
    const ticker = (workbook.company.ticker || "model").replace(/[^A-Za-z0-9-]/g, "");
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${ticker}-model.xlsx"`,
        "Cache-Control": "private, no-store",
      },
    });
  });
}
