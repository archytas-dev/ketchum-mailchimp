import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole, isStaffRole } from "@/lib/auth";
import { ordenarClientesActivos } from "@/lib/clientes";
import ReportesClient, { type ClientOpt } from "./ReportesClient";

export const dynamic = "force-dynamic";

// KET-49.
export default async function ReportesPage() {
  const supabase = await createClient();
  const { effective } = await getEffectiveRole(supabase);
  const isStaff = isStaffRole(effective);

  const { data: clientRows } = await supabase.from("clients").select("id, slug, nombre");
  // [19/08] Cutover: solo la herramienta real (no-legado). Los reportes sobre clippings
  // viejos (v1/v2) ya no se toman por acá.
  const clients = ordenarClientesActivos((clientRows ?? []) as ClientOpt[]);

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
