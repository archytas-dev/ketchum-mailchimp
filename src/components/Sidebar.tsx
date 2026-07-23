"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  History,
  BarChart3,
  Upload,
  LogOut,
  Menu,
} from "lucide-react";
import KetchumLogo from "@/components/KetchumLogo";
import Footer from "@/components/Footer";
import { logout } from "@/app/login/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

type Item = { href: string; label: string; Icon: typeof LayoutDashboard; blocked?: boolean };

const ITEMS: Item[] = [
  { href: "/hoy", label: "Principal", Icon: LayoutDashboard },
  { href: "/precarga", label: "Precarga", Icon: Upload },
  { href: "/historial", label: "Historial", Icon: History },
  { href: "/estadisticas", label: "Estadísticas", Icon: BarChart3 },
];

function NavContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-5 border-b border-white/10">
        <KetchumLogo className="h-6 w-auto brightness-0 invert" />
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {ITEMS.map(({ href, label, Icon, blocked }) => {
          if (blocked) {
            return (
              <div
                key={href}
                title="Próximamente"
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-white/35 cursor-not-allowed select-none"
              >
                <Icon size={18} />
                <span>{label}</span>
                <span className="ml-auto text-[10px] uppercase tracking-wide bg-white/10 rounded px-1.5 py-0.5">
                  Pronto
                </span>
              </div>
            );
          }
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              className={
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition " +
                (active
                  ? "bg-white/15 font-medium"
                  : "text-white/75 hover:bg-white/10 hover:text-white")
              }
            >
              <Icon size={18} />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="px-3 py-3 border-t border-white/10">
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <button className="w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-white/75 hover:bg-white/10 hover:text-white transition" />
            }
          >
            <LogOut size={18} />
            <span>Cerrar sesión</span>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Cerrar sesión?</AlertDialogTitle>
              <AlertDialogDescription>Vas a salir de tu cuenta.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <form action={logout}>
                <button
                  type="submit"
                  className="inline-flex h-9 items-center justify-center rounded-md bg-[#243f55] px-4 text-sm font-medium text-white hover:bg-[#1b3143]"
                >
                  Cerrar sesión
                </button>
              </form>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <div className="[&_a]:!text-white/40 [&_span]:!text-white/60 opacity-90">
          <Footer logoSize={14} />
        </div>
      </div>
    </div>
  );
}

export default function Sidebar() {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* Desktop: fijo, alto de pantalla completo */}
      <aside className="hidden md:block w-56 shrink-0 bg-[#243f55] text-white h-screen sticky top-0">
        <NavContent />
      </aside>

      {/* Mobile: barra superior con hamburguesa */}
      <header className="md:hidden sticky top-0 z-40 flex items-center gap-3 bg-[#243f55] text-white px-4 py-3">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            aria-label="Abrir menú"
            render={<button className="p-1 -ml-1" />}
          >
            <Menu size={22} />
          </SheetTrigger>
          <SheetContent side="left" className="w-64 bg-[#243f55] text-white border-none p-0">
            <SheetTitle className="sr-only">Menú</SheetTitle>
            <NavContent onNavigate={() => setOpen(false)} />
          </SheetContent>
        </Sheet>
        <KetchumLogo className="h-5 w-auto brightness-0 invert" />
      </header>
    </>
  );
}
