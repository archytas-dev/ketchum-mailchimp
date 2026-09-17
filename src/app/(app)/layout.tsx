import Sidebar from "@/components/Sidebar";
import RolBadge from "@/components/RolBadge";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole, isStaffRole } from "@/lib/auth";
import { etiquetaPlano } from "@/lib/data-plane";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { effective } = await getEffectiveRole(supabase);
  const isStaff = isStaffRole(effective);
  const plano = etiquetaPlano(supabase);
  return (
    <div className="min-h-screen bg-slate-50 md:flex">
      <RolBadge />
      {plano ? (
        <div className="fixed bottom-3 right-4 z-50 rounded-md border border-violet-300 bg-violet-50 px-2 py-1 text-[11px] font-semibold text-violet-800 shadow-sm">
          {plano}
        </div>
      ) : null}
      <Sidebar isStaff={isStaff} />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
