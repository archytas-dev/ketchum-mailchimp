import type { SupabaseClient } from "@supabase/supabase-js";

export type Rol = "dev" | "pm" | "cliente";

// Primer chequeo de rol de la app (antes cada pagina operaba igual para cualquier usuario
// logueado). Refleja is_staff()/current_rol() del schema -- si esas funciones SQL cambian,
// esto tiene que cambiar con ellas.
export async function getCurrentRole(supabase: SupabaseClient): Promise<Rol> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return "cliente";
  const { data } = await supabase
    .from("profiles")
    .select("rol")
    .eq("id", userData.user.id)
    .maybeSingle();
  const rol = (data?.rol as Rol | undefined) ?? "cliente";
  return rol === "dev" || rol === "pm" ? rol : "cliente";
}

export function isStaffRole(rol: Rol): boolean {
  return rol === "dev" || rol === "pm";
}
