// Puente hacia el Error Handler Global de la agencia (mismo patrón que comar-dashboard/src/lib/alertar-error.ts).
// Para fallas "silenciosas" del portal (crons, side-effects best-effort) donde nadie más se
// va a enterar si algo se rompe. No usar para errores que ya el usuario ve en pantalla.
//
// Nunca debe tumbar la operación que la disparó: si el webhook mismo falla, se traga el error.

const WEBHOOK_URL = "https://archytasai.app.n8n.cloud/webhook/ketchum-alerta-error";

export async function alertarErrorSlack(contexto: string, error: unknown): Promise<void> {
  try {
    const mensaje = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    const ambiente = process.env.VERCEL_ENV || "local";

    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contexto, mensaje, stack, ambiente }),
    });
  } catch {
    // best-effort: una alerta rota no debe romper la operación real que la disparó
  }
}
