import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole, isStaffRole } from "@/lib/auth";
import { Info } from "lucide-react";
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
    // Los *-test NO se ofrecen acá, ni siquiera a staff: no tienen configuración propia (0
    // medios, 0 keywords, 0 secciones). Son el destino donde la versión nueva del clipping
    // guarda sus resultados de prueba. La config que esa versión LEE es la del cliente real
    // -- verificado en los 4 workflows v3: get_config_clipping(p_slug: 'booking'|'bms'|...).
    // Ofrecerlos acá solo lograba una pantalla vacía que parecía un error.
    .filter((c) => !c.slug.endsWith("-test"))
    .sort((a, b) => {
      const ia = ORDEN.indexOf(a.slug);
      const ib = ORDEN.indexOf(b.slug);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-xl font-semibold mb-1">Base de Datos</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Medios, palabras clave y secciones de cada clipping.
      </p>

      {/* Los cambios de acá los toma la version nueva del clipping, que todavia no es la que
          se envia. Se avisa sin nombrar el detalle tecnico de donde sale la config actual:
          al cliente no le aporta y solo genera preguntas. */}
      <div className="mb-6 flex items-start gap-2.5 rounded-lg border border-brand/20 bg-brand/5 p-3">
        <Info size={16} className="mt-0.5 shrink-0 text-brand" />
        <p className="text-sm text-foreground/80">
          Lo que edites acá queda guardado y se va a aplicar en la nueva versión del clipping,
          que estamos terminando de poner en marcha. El clipping que recibís todos los días
          todavía no toma estos cambios — te avisamos apenas empiece a hacerlo.
        </p>
      </div>

      <BaseDatosClient clients={clients} isStaff={isStaff} />
    </div>
  );
}
