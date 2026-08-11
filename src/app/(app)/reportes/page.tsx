import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole, isStaffRole } from "@/lib/auth";
import { ordenarClientes } from "@/lib/clientes";
import ReportesClient, { type ClientOpt } from "./ReportesClient";

export const dynamic = "force-dynamic";

// KET-49. A diferencia de Base de Datos, esta pantalla SI se le muestra al cliente aunque su
// clipping lo genere todavia v2: reportar un error no depende de que la config viva en estas
// tablas -- es texto libre sobre un envio que ya recibio.
export default async function ReportesPage() {
  const supabase = await createClient();
  const { effective } = await getEffectiveRole(supabase);
  const isStaff = isStaffRole(effective);

  const { data: clientRows } = await supabase.from("clients").select("id, slug, nombre");
  // Las dos versiones de cada clipping: se puede reportar un error sobre cualquiera, pero
  // sobre la que se envía hoy se avisa que ya no se corrige (ver el cartel rojo en el form).
  const clients = ordenarClientes((clientRows ?? []) as ClientOpt[]);

  return (
    // Ancho completo, mismo criterio que Base de Datos: con max-w quedaba angosto mientras
    // sobraba viewport a los costados.
    <div className="w-full p-6">
      <h1 className="text-xl font-semibold mb-1">Reporte de errores</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Si algo salió mal en un clipping, contanoslo acá. Queda registrado con fecha y lo
        seguimos hasta resolverlo.
      </p>
      <ReportesClient clients={clients} isStaff={isStaff} />
    </div>
  );
}
