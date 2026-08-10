import Sidebar from "@/components/Sidebar";
import RolBadge from "@/components/RolBadge";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole, isStaffRole } from "@/lib/auth";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { effective } = await getEffectiveRole(supabase);
  const isStaff = isStaffRole(effective);
  return (
    <div className="min-h-screen bg-slate-50 md:flex">
      <RolBadge />
      <Sidebar isStaff={isStaff} />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
