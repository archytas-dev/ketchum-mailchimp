import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export type Rol = "dev" | "pm" | "cliente";

// Cookie del toggle "Ver como cliente" (TDD §8.1). Es pura simulación de UI -- nunca cambia
// el rol real en `profiles` ni afecta ninguna policy de RLS (que sigue leyendo current_rol()
// desde la base). Si un dev la setea a mano no gana nada: los datos que puede traer siguen
// siendo los de su rol real, esto solo decide qué se le OCULTA en el render.
const COOKIE_VER_COMO_CLIENTE = "ketchum_ver_como_cliente";

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

export async function isViewingAsCliente(): Promise<boolean> {
  const store = await cookies();
  return store.get(COOKIE_VER_COMO_CLIENTE)?.value === "1";
}

// Rol REAL (para el badge) + rol EFECTIVO (para decidir qué renderizar). Un dev con el
// toggle activo tiene real="dev" pero effective="cliente" -- usar `effective` en cualquier
// isStaffRole() que gatee UI, y `real` solo para mostrarle a el mismo qué rol tiene.
export async function getEffectiveRole(
  supabase: SupabaseClient,
): Promise<{ real: Rol; effective: Rol; simulando: boolean }> {
  const real = await getCurrentRole(supabase);
  const simulando = isStaffRole(real) && (await isViewingAsCliente());
  return { real, effective: simulando ? "cliente" : real, simulando };
}
