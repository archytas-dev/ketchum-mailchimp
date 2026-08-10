// Marca visual de "esto solo lo ve dev/pm" directamente sobre la sección, no solo en el
// badge de esquina (RolBadge). Pedido explícito: el badge global se notaba poco -- acá
// cada bloque staff-only queda coloreado lila para que sea obvio de un vistazo cuál
// contenido el cliente nunca va a ver, sin tener que acordarse de mirar arriba a la derecha.
export default function StaffOnlySection({
  children,
  label = "Solo staff",
}: {
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <div className="relative rounded-xl border-2 border-purple-300 bg-purple-50/50 dark:bg-purple-950/10 pt-3">
      <span className="absolute -top-2.5 left-3 rounded-full bg-purple-600 text-white text-[10px] font-semibold px-2 py-0.5 tracking-wide uppercase">
        {label}
      </span>
      <div className="px-3 pb-3">{children}</div>
    </div>
  );
}
