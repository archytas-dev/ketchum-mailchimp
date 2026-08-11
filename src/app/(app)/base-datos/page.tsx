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
  // Se ofrecen los 8: cada cliente aparece dos veces, la version actual y la Version Nueva.
  // Quedan uno al lado del otro (Booking, Booking - Version Nueva, BMS, BMS - Version Nueva...)
  // para que se lea como un par y no como ocho clientes distintos.
  const clients = ((clientRows ?? []) as ClientOpt[]).sort((a, b) => {
    const base = (s: string) => s.replace(/-test$/, "");
    const ia = ORDEN.indexOf(base(a.slug));
    const ib = ORDEN.indexOf(base(b.slug));
    if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    // Dentro del par, primero la version actual.
    return Number(a.slug.endsWith("-test")) - Number(b.slug.endsWith("-test"));
  });

  return (
    // Ancho completo: las tablas de esta pantalla tienen 5 columnas y con max-w-5xl quedaban
    // apretadas contra el borde mientras sobraba viewport a los costados.
    <div className="w-full p-6">
      <h1 className="text-xl font-semibold mb-1">Base de Datos</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Medios, palabras clave y secciones de cada clipping.
      </p>

      <BaseDatosClient clients={clients} isStaff={isStaff} />
    </div>
  );
}
