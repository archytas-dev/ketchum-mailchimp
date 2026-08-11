import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole, isStaffRole } from "@/lib/auth";
import ReportesClient, { type ClientOpt } from "./ReportesClient";

export const dynamic = "force-dynamic";

const ORDEN = ["booking", "bms", "msd", "mars"];

// KET-49. A diferencia de Base de Datos, esta pantalla SI se le muestra al cliente aunque su
// clipping lo genere todavia v2: reportar un error no depende de que la config viva en estas
// tablas -- es texto libre sobre un envio que ya recibio.
export default async function ReportesPage() {
  const supabase = await createClient();
  const { effective } = await getEffectiveRole(supabase);
  const isStaff = isStaffRole(effective);

  const { data: clientRows } = await supabase.from("clients").select("id, slug, nombre");
  const clients = ((clientRows ?? []) as ClientOpt[])
    .filter((c) => isStaff || !c.slug.endsWith("-test"))
    .sort((a, b) => {
      const ia = ORDEN.indexOf(a.slug);
      const ib = ORDEN.indexOf(b.slug);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-xl font-semibold mb-1">Reporte de errores</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Si algo salió mal en un clipping, contanoslo acá. Queda registrado con fecha y lo
        seguimos hasta resolverlo.
      </p>
      <ReportesClient clients={clients} isStaff={isStaff} />
    </div>
  );
}
