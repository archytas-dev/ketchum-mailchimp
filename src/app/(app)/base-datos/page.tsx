import { createClient } from "@/lib/supabase/server";
import { getCurrentRole, isStaffRole } from "@/lib/auth";
import BaseDatosClient, { type ClientOpt } from "./BaseDatosClient";

export const dynamic = "force-dynamic";

const ORDEN = ["booking", "bms", "msd", "mars"];

export default async function BaseDatosPage() {
  const supabase = await createClient();
  const rol = await getCurrentRole(supabase);
  const { data: clientRows } = await supabase.from("clients").select("id, slug, nombre");
  const clients = ((clientRows ?? []) as ClientOpt[])
    // Las *-test son internas de Archytas para probar los flujos v3, no algo que el
    // cliente tenga que ver ni editar en esta pestaña.
    .filter((c) => !c.slug.endsWith("-test"))
    .sort((a, b) => {
      const ia = ORDEN.indexOf(a.slug);
      const ib = ORDEN.indexOf(b.slug);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-xl font-semibold mb-1">Base de Datos</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Medios, palabras clave y secciones de cada clipping. Lo que sumes acá se agrega
        automáticamente al scrapeo desde la próxima corrida.
      </p>
      <BaseDatosClient clients={clients} isStaff={isStaffRole(rol)} />
    </div>
  );
}
