import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Editor, { type Note } from "./Editor";
import KetchumLogo from "@/components/KetchumLogo";
import Footer from "@/components/Footer";

function todayAR(): string {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

export default async function ClippingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: clipping } = await supabase
    .from("clippings")
    .select("id, fecha, estado, clients(nombre, slug)")
    .eq("id", id)
    .single();

  if (!clipping) notFound();

  const { data: notes } = await supabase
    .from("notes")
    .select(
      "id, seccion, medio, titulo, snippet, url, pub_date, orden, incluida, origen, pintada",
    )
    .eq("clipping_id", id)
    .order("orden", { ascending: true });

  const client = Array.isArray(clipping.clients)
    ? clipping.clients[0]
    : clipping.clients;
  const slug = client?.slug ?? "";
  const isPast = clipping.fecha < todayAR();

  // Clipping pasado = solo lectura (visual de lo que se envió).
  let exportHtml: string | null = null;
  if (isPast) {
    const { data: exp } = await supabase
      .from("exports")
      .select("html")
      .eq("clipping_id", id)
      .limit(1)
      .maybeSingle();
    exportHtml = exp?.html ?? null;
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="bg-[#243f55] text-white sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/hoy" className="text-white/70 hover:text-white">
              ←
            </Link>
            <h1 className="font-semibold">
              {client?.nombre ?? "—"} · {clipping.fecha}
            </h1>
            {isPast && (
              <span className="text-xs bg-white/15 rounded-full px-2 py-0.5">
                solo lectura
              </span>
            )}
          </div>
          <KetchumLogo className="h-5 w-auto invert brightness-0" />
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6">
        <Editor
          clippingId={id}
          slug={slug}
          initial={(notes ?? []) as Note[]}
          isPast={isPast}
          exportHtml={exportHtml}
        />
      </div>
      <Footer />
    </main>
  );
}
