import { withUser, financeDeps } from "@/arch/v1/presentation/finance/finance-http";
import { annotateCorrection } from "@/arch/v1/application/finance-use-cases/annotate-correction-use-case";

// Follow-up del aprendizaje tras categorizar a mano: guarda la nota "porqué" del movimiento y/o
// propaga su categoría a los movimientos con el mismo texto. Devuelve { applied }.
export async function POST(req: Request) {
  const body = await req.json();
  return withUser(req, (userId) =>
    annotateCorrection(financeDeps, userId, String(body.transactionId ?? ""), {
      note: typeof body.note === "string" ? body.note : undefined,
      applyToSameText: body.applyToSameText === true,
    }),
  );
}
