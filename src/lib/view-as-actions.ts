"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const COOKIE_VER_COMO_CLIENTE = "ketchum_ver_como_cliente";

// TDD §8.1: "Simular sesión cliente: Toggle 'Ver como cliente'". Cookie de UI únicamente
// -- no toca profiles.rol ni ninguna policy de RLS (ver comentario en lib/auth.ts).
export async function toggleViewAsCliente(formData: FormData) {
  const store = await cookies();
  const activo = store.get(COOKIE_VER_COMO_CLIENTE)?.value === "1";
  // store.delete(...), set(..., {maxAge:0}) y set(..., {expires: new Date(0)}) no borraban
  // la cookie de verdad en esta versión de Next -- confirmado con un test que leía las
  // cookies del browser antes/después de "volver": quedaba "1" sin cambios. En vez de
  // borrarla, sobreescribimos el VALOR a "0" (isViewingAsCliente ya solo chequea === "1").
  store.set(COOKIE_VER_COMO_CLIENTE, activo ? "0" : "1", { path: "/", maxAge: 60 * 60 * 24 });
  const volver = (formData.get("volver") as string) || "/hoy";
  redirect(volver);
}
