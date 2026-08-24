import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole, isStaffRole } from "@/lib/auth";
import { ordenarClientes } from "@/lib/clientes";
import BaseDatosClient, { type ClientOpt } from "./BaseDatosClient";

export const dynamic = "force-dynamic";

export default async function BaseDatosPage() {
  const supabase = await createClient();
  // Rol EFECTIVO: si un dev tiene activo "Ver como cliente", esto resuelve a 'cliente'
  // aunque su rol real siga siendo dev -- oculta Google Alerts/Seguimiento igual que vería
  // Fedra. La seguridad real la sigue dando RLS, no esto.
  const { effective } = await getEffectiveRole(supabase);
  const isStaff = isStaffRole(effective);

  const { data: clientRows } = await supabase.from("clients").select("id, slug, nombre");
  // [19/08] Cutover: la config (medios/tiers/keywords) sigue viviendo bajo el client_id BASE
  // (los 4 workflows v3 la piden con get_config_clipping(p_slug: 'bms'|'booking'|'mars'|'msd')),
  // así que acá se sigue pasando la lista SIN filtrar -- BaseDatosClient necesita el par
  // completo para resolver configClientId. El filtro a solo no-legado se hace en el dropdown,
  // adentro del client component.
  const clients = ordenarClientes((clientRows ?? []) as ClientOpt[]);

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
