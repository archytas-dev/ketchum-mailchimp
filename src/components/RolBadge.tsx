import { createClient } from "@/lib/supabase/server";
import { isStaffRole, isViewingAsCliente, type Rol } from "@/lib/auth";
import { toggleViewAsCliente } from "@/lib/view-as-actions";

// TDD §6.3: señal visual, no control de acceso -- la seguridad la da RLS en la base.
// El cliente no ve absolutamente nada distinto (por eso rol==="cliente" -> null).
export default async function RolBadge() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("rol")
    .eq("id", userData.user.id)
    .maybeSingle();
  const rolReal = (data?.rol ?? "cliente") as Rol;
  if (!isStaffRole(rolReal)) return null;

  const simulando = await isViewingAsCliente();

  if (simulando) {
    return (
      <div className="fixed top-3 right-4 z-50 flex items-center gap-2">
        <span className="rounded-md bg-slate-600 text-white text-[11px] font-semibold tracking-wide shadow-sm px-2 py-1">
          {rolReal.toUpperCase()} · viendo como cliente
        </span>
        <form action={toggleViewAsCliente}>
          <button
            type="submit"
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 shadow-sm"
          >
            Volver a mi vista
          </button>
        </form>
      </div>
    );
  }

  const estilo = rolReal === "dev" ? "bg-purple-600 text-white" : "bg-amber-500 text-white";
  return (
    <div className="fixed top-3 right-4 z-50 flex items-center gap-2">
      <span className={"rounded-md px-2 py-1 text-[11px] font-semibold tracking-wide shadow-sm " + estilo}>
        {rolReal.toUpperCase()}
      </span>
      <form action={toggleViewAsCliente}>
        <button
          type="submit"
          className="rounded-md border border-purple-300 bg-white px-2 py-1 text-[11px] font-medium text-purple-700 hover:bg-purple-50 shadow-sm"
        >
          Ver como cliente
        </button>
      </form>
    </div>
  );
}
