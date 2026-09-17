import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { registrarPlano } from "@/lib/data-plane";

export async function createClient() {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component; middleware handles refresh.
          }
        },
      },
    },
  );

  // El plano se resuelve por usuario autenticado, nunca por una variable global ni por
  // un valor enviado desde el navegador. Fedra queda en v3/public; el usuario de prueba,
  // en v4/test.
  const { data: { user } } = await supabase.auth.getUser();
  registrarPlano(supabase, user?.id);

  return supabase;
}
