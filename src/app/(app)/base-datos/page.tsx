import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole, isStaffRole } from "@/lib/auth";
import { Sparkles } from "lucide-react";
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

  // Mismo motivo que Actividad (10/08): v2 (lo que hoy le genera el clipping real a Fedra)
  // lee keywords/medios/gacetillas/tiers de un Google Sheet, no de estas tablas -- si editara
  // algo acá hoy, no pasaría nada con su clipping real. Peor que una pantalla vacía: parece
  // que funciona y no hace nada. Ocultar hasta que v3 esté activo para clientes reales.
  if (!isStaff) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <h1 className="text-xl font-semibold mb-1">Base de Datos</h1>
        <div className="mt-6 flex flex-col items-center text-center gap-3 rounded-xl border border-dashed border-border bg-card p-10">
          <Sparkles size={22} className="text-brand" />
          <p className="text-base font-medium text-foreground">Próximamente</p>
          <p className="text-sm text-muted-foreground max-w-sm">
            Estamos terminando de armar esta sección para que puedas gestionar tus palabras
            clave, medios, gacetillas y tiers directamente. Todavía no hay nada para mostrar acá.
          </p>
        </div>
      </div>
    );
  }

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
