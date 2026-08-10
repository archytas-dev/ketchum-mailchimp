import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole, isStaffRole } from "@/lib/auth";
import BaseDatosClient, { type ClientOpt } from "./BaseDatosClient";

export const dynamic = "force-dynamic";

const ORDEN = ["booking", "bms", "msd", "mars"];

export default async function BaseDatosPage() {
  const supabase = await createClient();
  // Rol EFECTIVO: si un dev tiene activo "Ver como cliente", esto resuelve a 'cliente'
  // aunque su rol real siga siendo dev -- oculta Google Alerts/Seguimiento/*-test igual
  // que vería Fedra. La seguridad real la sigue dando RLS, no esto.
  const { effective } = await getEffectiveRole(supabase);
  const isStaff = isStaffRole(effective);
  const { data: clientRows } = await supabase.from("clients").select("id, slug, nombre");
  const clients = ((clientRows ?? []) as ClientOpt[])
    // Las *-test son internas de Archytas para probar los flujos v3. El cliente no debe
    // verlas (TDD §9: "Entorno test" ❌ cliente), pero dev/pm SÍ tienen que poder elegirlas
    // para romperlas libremente (TDD §8.1) -- antes se filtraban para todos, sin mirar el rol.
    .filter((c) => isStaff || !c.slug.endsWith("-test"))
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
      <BaseDatosClient clients={clients} isStaff={isStaff} />
    </div>
  );
}
