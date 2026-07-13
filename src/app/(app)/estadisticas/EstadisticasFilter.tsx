"use client";

import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";

type Cli = { id: string; nombre: string };

export default function EstadisticasFilter({
  clients,
  value,
}: {
  clients: Cli[];
  value: string;
}) {
  const router = useRouter();
  const label = value === "all" ? "Todos los clientes" : clients.find((c) => c.id === value)?.nombre ?? "Cliente";
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        const nv = v ?? "all";
        router.push(nv === "all" ? "/estadisticas" : `/estadisticas?cliente=${nv}`);
      }}
    >
      <SelectTrigger className="w-52 font-medium">
        <span>{label}</span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Todos los clientes</SelectItem>
        {clients.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.nombre}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
